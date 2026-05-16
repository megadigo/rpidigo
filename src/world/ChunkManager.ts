/**
 * ChunkManager — loads or generates 32×32 tile chunks, caches them in memory.
 * Writes new chunks to Firebase; reads existing chunks from Firebase.
 */
import { db } from '../firebase.ts'
import { ref, get, set, update } from 'firebase/database'
import type { ChunkData, TileData, EnemyInstance, PoiLayout } from './types.ts'
import { generateChunk, CHUNK_SIZE, buildNoise, type NoiseConfig } from './ChunkGen.ts'
import type { RoadNetwork } from './RoadNetwork.ts'
import type { generateHouseRoom } from './HouseGen.ts'
import type { generateCellarRoom } from './CellarGen.ts'
import { tileKey, chunkKey } from './utils.ts'

/** In-memory tile cache — key `tileKey(x,y)` for overworld. */
const tileCache = new Map<string, TileData>()
/** Set of chunk keys `chunkKey(cx,cy)` known to be loaded. */
const loadedChunks = new Set<string>()
/** Chunk keys currently being loaded/generated (to avoid double-generation). */
const pendingChunks = new Map<string, Promise<void>>()

// ── Room (house / dungeon floor) support ─────────────────────────────────

/** The currently active non-overworld room ID, or null when on overworld. */
let _activeRoom: string | null = null
/** Tile cache for the active room — keyed by local `tileKey(x,y)`. */
const _roomTileCache = new Map<string, TileData>()

/** Max cached chunks before evicting oldest. */
const MAX_CACHED_CHUNKS = 64
const chunkAccessOrder: string[] = []

let _seed = 0
let _pois: PoiLayout = { villages: [], dungeons: [] }
let _roads: RoadNetwork = { tileSet: new Set(), paths: [] }
let _noise: NoiseConfig | null = null

export function initChunkManager(seed: number, pois: PoiLayout, roads: RoadNetwork): void {
  _seed = seed
  _pois = pois
  _roads = roads
  _noise = buildNoise(seed)
}

export function getTile(x: number, y: number): TileData | undefined {
  if (_activeRoom !== null) return _roomTileCache.get(tileKey(x, y))
  return tileCache.get(tileKey(x, y))
}

/** Returns the currently active room ID, or null when in the overworld. */
export function getActiveRoom(): string | null { return _activeRoom }

/**
 * Switch to a house or dungeon room: loads its tiles from Firebase into
 * `_roomTileCache` and marks the room active so `getTile` reads from it.
 */
export async function enterRoom(roomId: string): Promise<void> {
  _activeRoom = roomId
  _roomTileCache.clear()
  const snap = await get(ref(db, `map/${roomId}`))
  if (!snap.exists()) {
    console.warn(`[ChunkManager] Room "${roomId}" not found in Firebase`)
    return
  }
  const all = snap.val() as Record<string, TileData>
  for (const [k, t] of Object.entries(all)) _roomTileCache.set(k, t)
}

/** Return to the overworld — clears the room cache. */
export function exitRoom(): void {
  _activeRoom = null
  _roomTileCache.clear()
}

/** Ensure a chunk is loaded.  Returns when the chunk is in tileCache. */
export async function ensureChunk(cx: number, cy: number): Promise<void> {
  const key = chunkKey(cx, cy)
  if (loadedChunks.has(key)) return

  const existing = pendingChunks.get(key)
  if (existing) return existing

  const promise = _loadOrGenerateChunk(cx, cy, key)
  pendingChunks.set(key, promise)
  try {
    await promise
  } finally {
    pendingChunks.delete(key)
  }
}

/** Ensure all chunks within `radius` chunks of (cx, cy). */
export async function ensureRadius(cx: number, cy: number, radius: number): Promise<void> {
  const promises: Promise<void>[] = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const ncx = cx + dx
      const ncy = cy + dy
      if (ncx < 0 || ncy < 0 || ncx >= 32 || ncy >= 32) continue
      promises.push(ensureChunk(ncx, ncy))
    }
  }
  await Promise.all(promises)
}

async function _loadOrGenerateChunk(cx: number, cy: number, key: string): Promise<void> {
  // Check sentinel in Firebase
  const sentinelRef = ref(db, `map/chunks/${key}`)
  const snap = await get(sentinelRef)

  if (snap.exists()) {
    // Chunk already generated — load tile data from Firebase
    await _loadChunkFromFirebase(cx, cy)
  } else {
    // Generate chunk and persist
    await _generateAndPersistChunk(cx, cy, key)
  }

  _trackAccess(key)
  loadedChunks.add(key)
}

async function _loadChunkFromFirebase(cx: number, cy: number): Promise<void> {
  const originX = cx * CHUNK_SIZE
  const originY = cy * CHUNK_SIZE
  const snap = await get(ref(db, `map/0`))
  if (!snap.exists()) return
  const all = snap.val() as Record<string, TileData>
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const k = tileKey(originX + lx, originY + ly)
      if (all[k]) tileCache.set(k, all[k])
    }
  }
}

async function _generateAndPersistChunk(cx: number, cy: number, key: string): Promise<void> {
  if (!_noise) throw new Error('ChunkManager not initialized')

  const chunkData = generateChunk(cx, cy, _seed, _pois, _roads, _noise) as ChunkData & {
    dungeonFloors?: Array<Array<{ room: string; tiles: Map<string, TileData>; enemies: EnemyInstance[] }>>
    houseRooms?: Array<ReturnType<typeof generateHouseRoom>>
    cellarRooms?: Array<ReturnType<typeof generateCellarRoom>>
  }

  // 1. Overworld tiles — single update per chunk (~30KB, under Firebase's 256KB limit)
  const tileUpdate: Record<string, unknown> = {}
  for (const [k, t] of Object.entries(chunkData.tiles)) {
    tileUpdate[`map/0/${k}`] = JSON.parse(JSON.stringify(t))
    tileCache.set(k, t)
  }
  await update(ref(db), tileUpdate)

  // 2. Enemies + NPCs (small; single write is fine)
  const entityUpdate: Record<string, unknown> = {}
  for (const enemy of chunkData.enemies) {
    entityUpdate[`entities/enemies/${enemy.id}`] = JSON.parse(JSON.stringify(enemy))
    entityUpdate[`presence/0/enemies/${enemy.id}`] = {
      x: enemy.x, y: enemy.y,
      templateId: enemy.templateId,
      state: enemy.state,
      hp: enemy.hp,
    }
  }
  for (const npc of chunkData.npcs) {
    entityUpdate[`entities/npcs/${npc.id}`] = JSON.parse(JSON.stringify(npc))
    entityUpdate[`presence/0/npcs/${npc.id}`] = {
      x: npc.x, y: npc.y,
      templateId: npc.templateId,
      state: npc.state,
    }
  }
  if (Object.keys(entityUpdate).length > 0) await update(ref(db), entityUpdate)

  // 3. Dungeon floors — each floor's tiles batched separately
  if (chunkData.dungeonFloors) {
    for (const floors of chunkData.dungeonFloors) {
      for (const floor of floors) {
        const floorTileUpdate: Record<string, unknown> = {}
        for (const [k, t] of floor.tiles) {
          floorTileUpdate[`map/${floor.room}/${k}`] = JSON.parse(JSON.stringify(t))
        }
        // Each dungeon floor is ~48KB at most — single update is fine
        await update(ref(db), floorTileUpdate)

        const floorEntityUpdate: Record<string, unknown> = {}
        for (const enemy of floor.enemies) {
          floorEntityUpdate[`entities/enemies/${enemy.id}`] = JSON.parse(JSON.stringify(enemy))
          floorEntityUpdate[`presence/${floor.room}/enemies/${enemy.id}`] = {
            x: enemy.x, y: enemy.y,
            templateId: enemy.templateId,
            state: enemy.state,
            hp: enemy.hp,
          }
        }
        if (Object.keys(floorEntityUpdate).length > 0) await update(ref(db), floorEntityUpdate)
      }
    }
  }

  // 4. House rooms — each room's tiles batched separately (rooms are small, ~144 tiles)
  if (chunkData.houseRooms) {
    for (const room of chunkData.houseRooms) {
      const roomUpdate: Record<string, unknown> = {}
      for (const [k, t] of room.tiles) {
        roomUpdate[`map/${room.roomId}/${k}`] = JSON.parse(JSON.stringify(t))
      }
      await update(ref(db), roomUpdate)
    }
  }

  // 4b. Cellar rooms — each room's tiles batched separately
  if (chunkData.cellarRooms) {
    for (const room of chunkData.cellarRooms) {
      const roomUpdate: Record<string, unknown> = {}
      for (const [k, t] of room.tiles) {
        roomUpdate[`map/${room.roomId}/${k}`] = JSON.parse(JSON.stringify(t))
      }
      await update(ref(db), roomUpdate)
    }
  }

  // 5. Sentinel last — signals other clients that tiles are fully written
  await set(ref(db, `map/chunks/${key}`), true)
}

function _trackAccess(key: string): void {
  const idx = chunkAccessOrder.indexOf(key)
  if (idx !== -1) chunkAccessOrder.splice(idx, 1)
  chunkAccessOrder.push(key)

  // Evict oldest if over limit
  if (chunkAccessOrder.length > MAX_CACHED_CHUNKS) {
    const oldest = chunkAccessOrder.shift()!
    if (oldest) {
      loadedChunks.delete(oldest)
      const [ocxStr, ocyStr] = oldest.split('_')
      const ocx = parseInt(ocxStr)
      const ocy = parseInt(ocyStr)
      const ox = ocx * CHUNK_SIZE
      const oy = ocy * CHUNK_SIZE
      for (let lx = 0; lx < CHUNK_SIZE; lx++)
        for (let ly = 0; ly < CHUNK_SIZE; ly++)
          tileCache.delete(tileKey(ox + lx, oy + ly))
    }
  }
}

/** Tile coordinate → chunk key using zero-padded coords. */
export function tileToChunk(x: number, y: number): string {
  return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))
}
