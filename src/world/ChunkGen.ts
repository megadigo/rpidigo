/**
 * ChunkGen — deterministic 32×32 tile chunk generator.
 * Pure function: same (cx, cy, seed, pois, roads) → same output on any client.
 */
import { createNoise2D } from 'simplex-noise'
import type { ChunkData, TileData, EnemyInstance, PoiLayout } from './types.ts'
import type { RoadNetwork } from './RoadNetwork.ts'
import { mulberry32, seededRandInt } from './utils.ts'
import { generateVillage } from './VillageGen.ts'
import { generateDungeon } from './DungeonGen.ts'

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

/** Tile variants per zone, weighted by detail noise. */
const ZONE_TILES: Record<Zone, string[]> = {
  plains:  ['grass', 'grass', 'grass', 'grass_tall', 'flower_yellow', 'flower_red', 'dirt_path', 'rock_small'],
  forest:  ['grass_dark', 'grass_dark', 'tree_oak', 'tree_pine', 'tree_dead', 'bush', 'mushroom', 'log', 'moss_rock'],
  river:   ['water_shallow', 'water_shallow', 'water_deep', 'sand_bank', 'reeds', 'mud'],
  desert:  ['sand', 'sand', 'sand_dune', 'dry_rock', 'cactus', 'dry_grass', 'oasis_water', 'quicksand'],
  village: ['cobblestone'],
  dungeon: ['dungeon_entrance'],
}

function pickTile(zone: Zone, detail: number): string {
  const list = ZONE_TILES[zone]
  const idx = Math.floor(((detail + 1) / 2) * list.length) % list.length
  return list[idx]
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
  const villageNpcs = villagesInChunk.flatMap(v => {
    const layout = generateVillage(v.id, v.x, v.y, seed ^ v.x ^ v.y)
    for (const [k, t] of layout.tiles) villageTiles.set(k, t)
    return layout.npcs
  })

  // Per-tile generation
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const x = chunkOriginX + lx
      const y = chunkOriginY + ly
      const key = `${x}_${y}`

      // Out-of-bounds → void
      if (x >= WORLD_MAX || y >= WORLD_MAX || x < 0 || y < 0) {
        tiles[key] = { type: 'void' }
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
        tiles[key] = { type: 'dungeon_entrance' }
        continue
      }

      // Road stamp
      if (roads.tileSet.has(key)) {
        // If base terrain is water place bridge, else dirt_path
        const baseZone = classifyZone(x, y, noise)
        tiles[key] = { type: baseZone === 'river' ? 'bridge' : 'dirt_path' }
        continue
      }

      // Noise-based tile
      const zone = classifyZone(x, y, noise)
      const detail = noise.detail(x / 20, y / 20)
      tiles[key] = { type: pickTile(zone, detail) }

      // River bank decoration (1-tile border)
      if (zone !== 'river') {
        const neighbors = [
          classifyZone(x - 1, y, noise),
          classifyZone(x + 1, y, noise),
          classifyZone(x, y - 1, noise),
          classifyZone(x, y + 1, noise),
        ]
        if (neighbors.includes('river')) {
          tiles[key] = { type: rand() > 0.5 ? 'sand_bank' : 'reeds' }
        }
      }

      // Enemy spawn roll (skip non-natural zones and impassable tiles)
      const passable = isPassableTile(tiles[key].type)
      if (passable) {
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
    generateDungeon(d.id, seed ^ d.x ^ d.y),
  )

  // Attach dungeon floors as a non-standard field so ChunkManager can persist them
  const result = { tiles, enemies, npcs } as ChunkData & { dungeonFloors?: ReturnType<typeof generateDungeon>[] }
  if (_dungeonFloors.length > 0) result.dungeonFloors = _dungeonFloors

  return result
}

/** Quick impassability check by tile type — mirrors CollisionMap logic. */
function isPassableTile(type: string): boolean {
  const impassable = new Set([
    'tree_oak', 'tree_pine', 'tree_dead', 'rock_small', 'rock_large', 'moss_rock',
    'cactus', 'water_shallow', 'water_deep', 'oasis_water', 'house_wall',
    'dungeon_wall', 'dungeon_pillar', 'fence', 'well', 'void',
  ])
  return !impassable.has(type)
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
