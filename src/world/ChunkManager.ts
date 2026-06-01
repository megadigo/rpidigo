/**
 * ChunkManager — loads or generates 32×32 tile chunks, caches them in memory.
 * Writes new chunks to Firebase; reads existing chunks from Firebase.
 */
import { db } from '../firebase.ts'
import { ref, get, update } from 'firebase/database'
import type { ChunkData, TileData, EnemyInstance, PoiLayout } from './types.ts'
import { generateChunk, CHUNK_SIZE, buildNoise, type NoiseConfig } from './ChunkGen.ts'
import type { RoadNetwork } from './RoadNetwork.ts'
import type { generateHouseRoom } from './HouseGen.ts'
import type { generateCellarRoom } from './CellarGen.ts'
import { tileKey, chunkKey } from './utils.ts'
import { TileRegistry } from '../registry/registries.ts'

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

/**
 * Mutate the local tile cache for position (x, y).
 * Used by gathering logic so CollisionMap and TilemapRenderer reflect the
 * change immediately, without waiting for a Firebase round-trip.
 */
export function setTile(x: number, y: number, data: TileData): void {
  if (_activeRoom !== null) {
    _roomTileCache.set(tileKey(x, y), data)
  } else {
    tileCache.set(tileKey(x, y), data)
  }
}

/**
 * If a tile's regen timer has expired and an originalId is recorded,
 * restore the tile to its pre-depletion state and return the restored copy.
 * Otherwise returns the tile unchanged.
 *
 * Also queues an async Firebase write so the restored state persists.
 */
function _regenIfExpired(tile: TileData, key: string, room: string): TileData {
  const { regenAt, originalId, originalLayer } = tile.metadata ?? {}
  if (!regenAt || !originalId || Date.now() < regenAt) return tile

  // Get the tile def so we know what `becomesOnGather` was
  let becomes: string | undefined
  try { becomes = TileRegistry.get(originalId).becomesOnGather } catch { /* unknown */ }

  const newMeta = { ...(tile.metadata ?? {}) }
  delete newMeta.regenAt
  delete newMeta.originalId
  delete newMeta.originalLayer
  delete newMeta.charges

  let restored: TileData
  if ((originalLayer ?? 'MIDDLE') === 'MIDDLE') {
    // Remove the "becomes" tile from m[], then push back the original
    const newM = (tile.m ?? []).filter(id => id !== becomes)
    newM.push(originalId)
    restored = {
      g: tile.g,
      m: newM,
      ...(tile.t            ? { t: tile.t }          : {}),
      ...(Object.keys(newMeta).length ? { metadata: newMeta } : {}),
    }
  } else {
    restored = {
      g: originalId,
      ...(tile.m            ? { m: tile.m }           : {}),
      ...(tile.t            ? { t: tile.t }            : {}),
      ...(Object.keys(newMeta).length ? { metadata: newMeta } : {}),
    }
  }

  // Persist asynchronously so the restored state survives next load
  if (room === '0') {
    const sep = key.indexOf('_')
    const tx = parseInt(key.slice(0, sep), 10)
    const ty = parseInt(key.slice(sep + 1), 10)
    void update(ref(db), { [overworldTilePath(tx, ty)]: restored })
  } else {
    void update(ref(db), { [`map/${room}/${key}`]: restored })
  }

  return restored
}

/** Returns the currently active room ID, or null when in the overworld. */
export function getActiveRoom(): string | null { return _activeRoom }

/**
 * Firebase path for a single overworld tile.
 * Tiles are stored under map/0/{cx}_{cy}/{x}_{y} so each chunk is an
 * independent subtree — reads and writes never touch other chunks.
 */
export function overworldTilePath(x: number, y: number): string {
  const cx = Math.floor(x / CHUNK_SIZE)
  const cy = Math.floor(y / CHUNK_SIZE)
  return `map/0/${cx}_${cy}/${tileKey(x, y)}`
}

/**
 * Returns the natural terrain zone at a world tile position using the same
 * noise thresholds as ChunkGen.  Returns 'plains' before initialisation.
 */
export function getWorldZone(x: number, y: number): string {
  if (!_noise) return 'plains'
  const el = (_noise.elevation(x / 300, y / 300) + 1) / 2
  const mo = (_noise.moisture(x / 200, y / 200) + 1) / 2
  if (el < 0.25 && mo > 0.6) return 'river'
  if (el > 0.55 && mo < 0.35) return 'desert'
  if (mo > 0.65 && el >= 0.3 && el <= 0.7) return 'forest'
  return 'plains'
}

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
  for (const [k, t] of Object.entries(all)) _roomTileCache.set(k, _regenIfExpired(t, k, roomId))
}

/** Return to the overworld — clears the room cache. */
export function exitRoom(): void {
  _activeRoom = null
  _roomTileCache.clear()
}

/**
 * Search the loaded room tile cache for the first tile that contains `tileType`
 * in its ground or middle layers. Returns its local coordinates, or null.
 */
export function findTileInRoom(tileType: string): { x: number; y: number } | null {
  for (const [key, tile] of _roomTileCache) {
    const allTypes = [tile.g, ...(tile.m ?? [])]
    if (allTypes.includes(tileType)) {
      const parts = key.split('_')
      return { x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) }
    }
  }
  return null
}

/**
 * Return all room-tile positions whose ground or middle layers include at least
 * one type from `tileTypes`. Results are sorted top-to-bottom, left-to-right.
 * Only works when a room is loaded (house / cellar / dungeon); returns [] on
 * the overworld.
 */
export function findAllTilesInRoom(
  tileTypes: ReadonlySet<string>,
): Array<{ x: number; y: number }> {
  const results: Array<{ x: number; y: number }> = []
  for (const [key, tile] of _roomTileCache) {
    const allTypes = [tile.g, ...(tile.m ?? [])]
    if (allTypes.some(t => tileTypes.has(t))) {
      const parts = key.split('_')
      results.push({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) })
    }
  }
  results.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)
  return results
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
  // The chunk subtree map/0/{key} acts as its own sentinel: present = generated.
  // One round-trip both checks existence and returns all tile data.
  const snap = await get(ref(db, `map/0/${key}`))

  if (snap.exists()) {
    const all = snap.val() as Record<string, TileData>
    for (const [k, t] of Object.entries(all)) {
      tileCache.set(k, _regenIfExpired(t, k, '0'))
    }
  } else {
    await _generateAndPersistChunk(cx, cy, key)
  }

  _trackAccess(key)
  loadedChunks.add(key)
}

async function _generateAndPersistChunk(cx: number, cy: number, key: string): Promise<void> {
  if (!_noise) throw new Error('ChunkManager not initialized')

  const chunkData = generateChunk(cx, cy, _seed, _pois, _roads, _noise) as ChunkData & {
    dungeonFloors?: Array<Array<{ room: string; tiles: Map<string, TileData>; enemies: EnemyInstance[] }>>
    houseRooms?: Array<ReturnType<typeof generateHouseRoom>>
    cellarRooms?: Array<ReturnType<typeof generateCellarRoom>>
  }

  // 1. Overworld tiles — stored under map/0/{cx}_{cy}/{x}_{y} so each chunk
  //    is an independent subtree; no other chunk's data is touched or read.
  const tileUpdate: Record<string, unknown> = {}
  for (const [k, t] of Object.entries(chunkData.tiles)) {
    tileUpdate[`map/0/${key}/${k}`] = t
    tileCache.set(k, t)
  }
  await update(ref(db), tileUpdate)

  // 2. Enemies + NPCs (small; single write is fine)
  const entityUpdate: Record<string, unknown> = {}
  for (const enemy of chunkData.enemies) {
    entityUpdate[`entities/enemies/${enemy.id}`] = enemy
    entityUpdate[`presence/0/enemies/${enemy.id}`] = {
      x: enemy.x, y: enemy.y,
      templateId: enemy.templateId,
      state: enemy.state,
      hp: enemy.hp,
    }
  }
  for (const npc of chunkData.npcs) {
    entityUpdate[`entities/npcs/${npc.id}`] = npc
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
          floorTileUpdate[`map/${floor.room}/${k}`] = t
        }
        await update(ref(db), floorTileUpdate)

        const floorEntityUpdate: Record<string, unknown> = {}
        for (const enemy of floor.enemies) {
          floorEntityUpdate[`entities/enemies/${enemy.id}`] = enemy
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

  // 4. House rooms (small, ~144 tiles each)
  if (chunkData.houseRooms) {
    for (const room of chunkData.houseRooms) {
      await _persistRoomTiles(room.roomId, room.tiles)
    }
  }

  // 4b. Cellar rooms — tiles + rat enemies
  if (chunkData.cellarRooms) {
    for (const room of chunkData.cellarRooms) {
      await _persistRoomTiles(room.roomId, room.tiles)
      const cellarEntityUpdate: Record<string, unknown> = {}
      for (const enemy of room.enemies) {
        cellarEntityUpdate[`entities/enemies/${enemy.id}`] = enemy
        cellarEntityUpdate[`presence/${room.roomId}/enemies/${enemy.id}`] = {
          x: enemy.x, y: enemy.y,
          templateId: enemy.templateId,
          state: enemy.state,
          hp: enemy.hp,
        }
      }
      if (Object.keys(cellarEntityUpdate).length > 0) await update(ref(db), cellarEntityUpdate)
    }
  }
  // No separate sentinel write — the presence of map/0/{key} after step 1 is the sentinel.
}

async function _persistRoomTiles(roomId: string, tiles: Map<string, TileData>): Promise<void> {
  const roomUpdate: Record<string, unknown> = {}
  for (const [k, t] of tiles) {
    roomUpdate[`map/${roomId}/${k}`] = t
  }
  await update(ref(db), roomUpdate)
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
