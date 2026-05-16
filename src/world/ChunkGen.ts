/**
 * ChunkGen — deterministic 32×32 tile chunk generator.
 * Pure function: same (cx, cy, seed, pois, roads) → same output on any client.
 */
import { createNoise2D } from 'simplex-noise'
import type { ChunkData, TileData, EnemyInstance, PoiLayout } from './types.ts'
import type { RoadNetwork } from './RoadNetwork.ts'
import { mulberry32, seededRandInt, tileKey } from './utils.ts'
import { generateVillage } from './VillageGen.ts'
import { generateDungeon } from './DungeonGen.ts'
import { generateHouseRoom } from './HouseGen.ts'
import { generateCellarRoom } from './CellarGen.ts'

const CELLAR_SEED_OFFSET = 0x51e11a2

export const CHUNK_SIZE = 32
export const WORLD_MAX = 1000   // tiles 0–999 are valid; 1000+ are void

/** Zone IDs. */
type Zone = 'plains' | 'forest' | 'river' | 'desert' | 'village' | 'dungeon'

export interface NoiseConfig {
  elevation: ReturnType<typeof createNoise2D>
  moisture:  ReturnType<typeof createNoise2D>
  detail:    ReturnType<typeof createNoise2D>
}

/** Build three noise functions from the world seed. */
export function buildNoise(seed: number): NoiseConfig {
  const r0 = mulberry32(seed)
  const r1 = mulberry32(seed ^ 0x12345678)
  const r2 = mulberry32(seed ^ 0x87654321)
  return {
    elevation: createNoise2D(r0),
    moisture:  createNoise2D(r1),
    detail:    createNoise2D(r2),
  }
}

/** Classify a tile coordinate into a natural zone (before POI/road stamps). */
function classifyZone(x: number, y: number, noise: NoiseConfig): Zone {
  const el = (noise.elevation(x / 300, y / 300) + 1) / 2   // 0–1
  const mo = (noise.moisture(x / 200, y / 200) + 1) / 2
  if (el < 0.25 && mo > 0.6) return 'river'
  if (el > 0.55 && mo < 0.35) return 'desert'
  if (mo > 0.65 && el >= 0.3 && el <= 0.7) return 'forest'
  return 'plains'
}

/** Returns a layered tile for the given zone and detail noise value. */
function pickTileLayers(zone: Zone, detail: number, rand: () => number): TileData {
  const d = (detail + 1) / 2   // normalise 0–1
  switch (zone) {
    case 'plains': {
      const ground = ['grass', 'grass', 'grass', 'grass_tall', 'flower_yellow', 'flower_red', 'dirt_path']
      const g = ground[Math.floor(d * ground.length) % ground.length]
      if (rand() < 0.05) return { g, m: ['rock_small'] }
      return { g }
    }
    case 'forest': {
      const features = ['tree_oak', 'tree_oak', 'tree_pine', 'bush', 'mushroom', 'log', 'moss_rock', 'stump']
      if (rand() < 0.65)
        return { g: 'grass_dark', m: [features[Math.floor(d * features.length) % features.length]] }
      return { g: 'grass_dark' }
    }
    case 'river': {
      const ground = ['water_shallow', 'water_shallow', 'water_deep', 'sand_bank', 'reeds', 'mud']
      return { g: ground[Math.floor(d * ground.length) % ground.length] }
    }
    case 'desert': {
      const ground = ['sand', 'sand', 'sand_dune', 'quicksand']
      const g = ground[Math.floor(d * ground.length) % ground.length]
      if (rand() < 0.15) {
        const features = ['dry_rock', 'cactus', 'cactus', 'dry_grass']
        return { g, m: [features[Math.floor(d * features.length) % features.length]] }
      }
      return { g }
    }
    case 'village': return { g: 'cobblestone' }
    case 'dungeon': return { g: 'dungeon_entrance' }
  }
}

/** Simple overworld enemy spawn table per zone. */
const SPAWN_TABLES: Record<string, Array<{ id: string; weight: number }>> = {
  plains:  [{ id: 'wolf_weak', weight: 60 }, { id: 'wolf_strong', weight: 20 }, { id: 'bandit_weak', weight: 15 }, { id: 'bandit_strong', weight: 5 }],
  forest:  [{ id: 'wolf_weak', weight: 40 }, { id: 'wolf_strong', weight: 20 }, { id: 'giant_spider', weight: 20 }, { id: 'goblin_scout_weak', weight: 10 }, { id: 'treant', weight: 10 }],
  river:   [{ id: 'river_troll', weight: 40 }, { id: 'crocodile', weight: 30 }, { id: 'water_spirit', weight: 20 }, { id: 'river_troll', weight: 10 }],
  desert:  [{ id: 'scorpion', weight: 35 }, { id: 'sand_worm', weight: 25 }, { id: 'mummy', weight: 25 }, { id: 'desert_bandit', weight: 15 }],
}

const SPAWN_CHANCE: Record<string, number> = {
  plains: 0.02, forest: 0.04, river: 0.03, desert: 0.03,
}

function rollEnemy(
  zone: Zone,
  x: number,
  y: number,
  seed: number,
  rand: () => number,
): EnemyInstance | null {
  const table = SPAWN_TABLES[zone]
  if (!table) return null
  const chance = SPAWN_CHANCE[zone] ?? 0
  if (rand() > chance) return null

  const total = table.reduce((s, e) => s + e.weight, 0)
  let roll = rand() * total
  let picked = table[0]
  for (const e of table) { roll -= e.weight; if (roll <= 0) { picked = e; break } }

  const [base, variant = 'standard'] = picked.id.split('_') as [string, string]
  return {
    id: `enemy_${x}_${y}_${seed & 0xffff}`,
    templateId: picked.id,
    baseType: base,
    variant,
    hp: 40, maxHp: 40, mp: 0, maxMp: 0, power: 10,
    room: '0', x, y,
    spawnRoom: '0', spawnX: x, spawnY: y,
    state: 'idle',
    executingPlayerId: null,
    lastLogicAt: 0,
    script: '# idle patrol script\npass',
    memory: {},
    carriedGold: 0,
  }
}

/**
 * Generate a 32×32 chunk.  Pure function — no Firebase calls.
 */
export function generateChunk(
  cx: number,
  cy: number,
  seed: number,
  pois: PoiLayout,
  roads: RoadNetwork,
  noise: NoiseConfig,
): ChunkData {
  const rand = mulberry32(seed ^ (cx * 73856093) ^ (cy * 19349663))
  const tiles: Record<string, TileData> = {}
  const enemies: EnemyInstance[] = []

  // POI lookup: is any village/dungeon POI in this chunk?
  const chunkOriginX = cx * CHUNK_SIZE
  const chunkOriginY = cy * CHUNK_SIZE
  const chunkEndX = chunkOriginX + CHUNK_SIZE - 1
  const chunkEndY = chunkOriginY + CHUNK_SIZE - 1

  const villagesInChunk = pois.villages.filter(v => v.x >= chunkOriginX && v.x <= chunkEndX && v.y >= chunkOriginY && v.y <= chunkEndY)
  const dungeonsInChunk = pois.dungeons.filter(d => d.x >= chunkOriginX && d.x <= chunkEndX && d.y >= chunkOriginY && d.y <= chunkEndY)

  // Pre-generate village overlays for this chunk
  const villageTiles = new Map<string, TileData>()
  const houseRooms: ReturnType<typeof generateHouseRoom>[] = []
  const cellarRooms: ReturnType<typeof generateCellarRoom>[] = []
  const villageNpcs = villagesInChunk.flatMap(v => {
    const layout = generateVillage(v.id, v.x, v.y, seed ^ v.x ^ v.y)
    for (const [k, t] of layout.tiles) villageTiles.set(k, t)
    // Generate a house interior for every building with an interior room
    for (const bp of layout.buildingPositions) {
      const houseRoom = generateHouseRoom(bp.x, bp.y, seed ^ bp.x ^ bp.y, bp.type)
      houseRooms.push(houseRoom)
      if (houseRoom.hasCellar) {
        cellarRooms.push(generateCellarRoom(bp.x, bp.y, seed ^ bp.x ^ bp.y ^ CELLAR_SEED_OFFSET))
      }
    }
    return layout.npcs
  })

  // Per-tile generation
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const x = chunkOriginX + lx
      const y = chunkOriginY + ly
      const key = tileKey(x, y)

      // Out-of-bounds → void
      if (x >= WORLD_MAX || y >= WORLD_MAX || x < 0 || y < 0) {
        tiles[key] = { g: 'void' }
        continue
      }

      // Village stamp takes highest priority
      if (villageTiles.has(key)) {
        tiles[key] = villageTiles.get(key)!
        continue
      }

      // Dungeon entrance stamp
      const isDungeonEntrance = dungeonsInChunk.some(d => d.x === x && d.y === y)
      if (isDungeonEntrance) {
        tiles[key] = { g: 'dungeon_entrance' }
        continue
      }

      // Road stamp — bridges removed; roads over water use dirt_path
      if (roads.tileSet.has(key)) {
        tiles[key] = { g: 'dirt_path' }
        continue
      }

      // Noise-based layered tile
      const zone = classifyZone(x, y, noise)
      const detail = noise.detail(x / 20, y / 20)
      let tileLayers = pickTileLayers(zone, detail, rand)

      // River bank decoration (1-tile border around water)
      if (zone !== 'river') {
        const neighbors = [
          classifyZone(x - 1, y, noise),
          classifyZone(x + 1, y, noise),
          classifyZone(x, y - 1, noise),
          classifyZone(x, y + 1, noise),
        ]
        if (neighbors.includes('river')) {
          tileLayers = { g: rand() > 0.5 ? 'sand_bank' : 'reeds' }
        }
      }

      tiles[key] = tileLayers

      // Enemy spawn roll (skip impassable positions)
      if (isPassableTile(tiles[key])) {
        const enemy = rollEnemy(zone, x, y, seed, rand)
        if (enemy) enemies.push(enemy)
      }
    }
  }

  // Collect NPCs (village NPCs + future NPC types)
  const npcs = villageNpcs.filter(n => {
    return n.x >= chunkOriginX && n.x <= chunkEndX && n.y >= chunkOriginY && n.y <= chunkEndY
  })

  // Write dungeon floors to the caller's responsibility — return dungeon metadata so ChunkManager can persist them
  const _dungeonFloors = dungeonsInChunk.map(d =>
    generateDungeon(d.x, d.y, seed ^ d.x ^ d.y),
  )

  // Attach dungeon floors and house rooms as non-standard fields so ChunkManager can persist them
  const result = { tiles, enemies, npcs } as ChunkData & {
    dungeonFloors?: ReturnType<typeof generateDungeon>[]
    houseRooms?: ReturnType<typeof generateHouseRoom>[]
    cellarRooms?: ReturnType<typeof generateCellarRoom>[]
  }
  if (_dungeonFloors.length > 0) result.dungeonFloors = _dungeonFloors
  if (houseRooms.length > 0) result.houseRooms = houseRooms
  if (cellarRooms.length > 0) result.cellarRooms = cellarRooms

  return result
}

/** Quick impassability check — mirrors CollisionMap logic without importing renderer. */
function isPassableTile(tile: TileData): boolean {
  const blocked = new Set([
    'tree_oak', 'tree_pine', 'coconut_tree', 'rock_small', 'rock_large', 'moss_rock',
    'cactus', 'water_shallow', 'water_deep', 'oasis_water',
    'dungeon_wall', 'dungeon_pillar',
    'house_hut', 'house_cabin', 'barracks', 'chapel', 'tavern', 'workshop',
    'well', 'tombstone', 'void',
  ])
  if (blocked.has(tile.g)) return false
  if (tile.m?.some(m => blocked.has(m))) return false
  return true
}

/** Compute all 100 village + 100 dungeon POI positions from seed. */
export function computePois(seed: number): PoiLayout {
  const rand = mulberry32(seed ^ 0xcafebabe)
  const villages = []
  const dungeons = []
  const SECTORS = 10
  const SECTOR_SIZE = 100
  const JITTER = 20

  for (let sx = 0; sx < SECTORS; sx++) {
    for (let sy = 0; sy < SECTORS; sy++) {
      const ox = sx * SECTOR_SIZE
      const oy = sy * SECTOR_SIZE
      const vx = ox + seededRandInt(rand, JITTER, SECTOR_SIZE - JITTER)
      const vy = oy + seededRandInt(rand, JITTER, SECTOR_SIZE - JITTER)
      const dx = ox + seededRandInt(rand, JITTER, SECTOR_SIZE - JITTER)
      const dy = oy + seededRandInt(rand, JITTER, SECTOR_SIZE - JITTER)
      villages.push({ id: `v_${sx}_${sy}`, x: vx, y: vy, sectorX: sx, sectorY: sy })
      dungeons.push({ id: `d_${sx}_${sy}`, x: dx, y: dy, sectorX: sx, sectorY: sy })
    }
  }
  return { villages, dungeons }
}
