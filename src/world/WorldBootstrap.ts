/**
 * WorldBootstrap — reads or creates the world seed and POI layout.
 * Runs once at app start before any gameplay.  No tiles are generated here.
 */
import { db } from '../firebase.ts'
import { ref, get, runTransaction, set, update } from 'firebase/database'
import type { PoiLayout } from './types.ts'
import { computePois } from './ChunkGen.ts'
import { buildRoadNetwork, type RoadNetwork } from './RoadNetwork.ts'
import { initChunkManager } from './ChunkManager.ts'
import { randomSeed } from './utils.ts'

export interface WorldConfig {
  seed: number
  pois: PoiLayout
  roads: RoadNetwork
}

/**
 * Increment this when TileData schema changes to force all clients to
 * discard stale Firebase map data and regenerate from scratch.
 */
const SCHEMA_VERSION = 5

let _worldConfig: WorldConfig | null = null

export function getWorldConfig(): WorldConfig {
  if (!_worldConfig) throw new Error('WorldBootstrap not completed')
  return _worldConfig
}

/**
 * Ensure seed and POIs exist in Firebase; initialize ChunkManager.
 * Safe to call concurrently from multiple clients — uses a Firebase transaction.
 */
export async function ensureWorldReady(): Promise<WorldConfig> {
  if (_worldConfig) return _worldConfig

  const seedRef = ref(db, 'config/seed')
  let seed: number

  // Transactionally claim the seed slot on first ever login
  const txResult = await runTransaction(seedRef, (current: number | null) => {
    if (current === null) return randomSeed()
    return current          // leave as-is
  })

  if (!txResult.committed || txResult.snapshot.val() === null) {
    // Shouldn't happen but fall back to reading
    const snap = await get(seedRef)
    seed = snap.val() as number
  } else {
    seed = txResult.snapshot.val() as number
  }

  // Load or generate POIs
  let pois: PoiLayout
  const poisRef = ref(db, 'config/pois')
  const poisSnap = await get(poisRef)
  if (poisSnap.exists()) {
    pois = poisSnap.val() as PoiLayout
  } else {
    pois = computePois(seed)
    await set(poisRef, pois)
  }

  const roads = buildRoadNetwork(pois)

  // Schema version check — wipe map/entities/presence if format changed
  const schemaSnap = await get(ref(db, 'config/schemaVersion'))
  if (schemaSnap.val() !== SCHEMA_VERSION) {
    console.warn('[WorldBootstrap] Schema version mismatch — wiping map data for regeneration')
    await update(ref(db), { map: null, entities: null, presence: null })
    await set(ref(db, 'config/schemaVersion'), SCHEMA_VERSION)
  }

  initChunkManager(seed, pois, roads)

  _worldConfig = { seed, pois, roads }
  return _worldConfig
}
