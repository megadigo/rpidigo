/**
 * DungeonGen — BSP-based dungeon floor layout.
 * Called from ChunkGen when generating a chunk that contains a dungeon entrance POI.
 * Writes dungeon rooms to Firebase under `map/dungeon_{id}_floor_1` etc. separately.
 */
import type { TileData, EnemyInstance } from './types.ts'
import { mulberry32, seededRandInt } from './utils.ts'

export interface DungeonFloor {
  room: string
  tiles: Map<string, TileData>
  enemies: EnemyInstance[]
}

export function generateDungeon(
  dungeonId: string,
  seed: number,
  floorCount = 2,
): DungeonFloor[] {
  const floors: DungeonFloor[] = []
  for (let f = 1; f <= floorCount; f++) {
    floors.push(generateFloor(dungeonId, seed, f, floorCount))
  }
  return floors
}

function generateFloor(
  dungeonId: string,
  seed: number,
  floorIndex: number,
  totalFloors: number,
): DungeonFloor {
  const room = `dungeon_${dungeonId}_floor_${floorIndex}`
  const rand = mulberry32(seed ^ (floorIndex * 0x9e3779b9))
  const tiles = new Map<string, TileData>()
  const enemies: EnemyInstance[] = []
  const SIZE = 40

  // Fill with walls (dungeon_floor as ground + dungeon_wall as middle)
  for (let x = 0; x < SIZE; x++)
    for (let y = 0; y < SIZE; y++)
      tiles.set(`${x}_${y}`, { g: 'dungeon_floor', m: ['dungeon_wall'] })

  // BSP rooms
  interface Rect { x: number; y: number; w: number; h: number }
  const rooms: Rect[] = []

  function split(rect: Rect, depth: number) {
    if (depth === 0 || rect.w < 8 || rect.h < 8) {
      // Carve room
      const rx = rect.x + seededRandInt(rand, 1, 2)
      const ry = rect.y + seededRandInt(rand, 1, 2)
      const rw = seededRandInt(rand, 4, rect.w - 3)
      const rh = seededRandInt(rand, 4, rect.h - 3)
      for (let x = rx; x < rx + rw; x++)
        for (let y = ry; y < ry + rh; y++)
          tiles.set(`${x}_${y}`, { g: 'dungeon_floor' })
      rooms.push({ x: rx, y: ry, w: rw, h: rh })
      return
    }
    const splitH = rand() > 0.5
    if (splitH && rect.h >= 8) {
      const splitY = rect.y + seededRandInt(rand, 4, rect.h - 4)
      split({ x: rect.x, y: rect.y, w: rect.w, h: splitY - rect.y }, depth - 1)
      split({ x: rect.x, y: splitY, w: rect.w, h: rect.y + rect.h - splitY }, depth - 1)
    } else if (rect.w >= 8) {
      const splitX = rect.x + seededRandInt(rand, 4, rect.w - 4)
      split({ x: rect.x, y: rect.y, w: splitX - rect.x, h: rect.h }, depth - 1)
      split({ x: splitX, y: rect.y, w: rect.x + rect.w - splitX, h: rect.h }, depth - 1)
    } else {
      split(rect, 0)
    }
  }

  split({ x: 0, y: 0, w: SIZE, h: SIZE }, 3)

  // Connect rooms with corridors
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i]
    const b = rooms[i + 1]
    const ax = a.x + Math.floor(a.w / 2)
    const ay = a.y + Math.floor(a.h / 2)
    const bx = b.x + Math.floor(b.w / 2)
    const by = b.y + Math.floor(b.h / 2)
    // Horizontal corridor
    const minX = Math.min(ax, bx)
    const maxX = Math.max(ax, bx)
    for (let x = minX; x <= maxX; x++) tiles.set(`${x}_${ay}`, { g: 'dungeon_floor' })
    // Vertical corridor
    const minY = Math.min(ay, by)
    const maxY = Math.max(ay, by)
    for (let y = minY; y <= maxY; y++) tiles.set(`${bx}_${y}`, { g: 'dungeon_floor' })
    // Door at junction
    tiles.set(`${bx}_${ay}`, { g: 'dungeon_floor', m: ['dungeon_door'] })
  }

  // Decorations and loot
  const floorMultiplier = 1 + (floorIndex - 1) * 0.5
  const isBossFloor = floorIndex === totalFloors
  for (const r of rooms) {
    // Scatter torches and pillars
    if (rand() < 0.4) tiles.set(`${r.x}_${r.y}`, { g: 'dungeon_floor', m: ['dungeon_torch'] })
    if (rand() < 0.2) tiles.set(`${r.x + 1}_${r.y + 1}`, { g: 'dungeon_floor', m: ['dungeon_pillar'] })
    if (rand() < 0.15) tiles.set(`${r.x}_${r.y + 1}`, { g: 'dungeon_trap' })

    // Chest in dead-end-ish rooms (small rooms)
    if (r.w <= 6 && r.h <= 6) {
      const cx = r.x + Math.floor(r.w / 2)
      const cy = r.y + Math.floor(r.h / 2)
      tiles.set(`${cx}_${cy}`, {
        g: 'dungeon_floor',
        m: ['dungeon_chest'],
        metadata: { gold: Math.floor((seededRandInt(rand, 20, 80)) * floorMultiplier) },
      })
    }

    // Enemies
    const spawnChance = floorIndex === 1 ? 0.15 : 0.20
    if (isBossFloor && r === rooms[rooms.length - 1]) {
      const ex = r.x + Math.floor(r.w / 2)
      const ey = r.y + Math.floor(r.h / 2)
      enemies.push(makeEnemy(`enemy_${dungeonId}_f${floorIndex}_boss`, 'dungeon_boss_strong', 'dungeon_boss', 'strong', room, ex, ey, 300, 50))
      tiles.set(`${ex - 1}_${ey}`, { g: 'dungeon_floor', m: ['dungeon_altar'] })
    } else if (rand() < spawnChance) {
      const ex = r.x + seededRandInt(rand, 1, r.w - 2)
      const ey = r.y + seededRandInt(rand, 1, r.h - 2)
      const templateId = floorIndex === 1
        ? pickFloor1Enemy(rand)
        : pickFloor2Enemy(rand)
      const [base, variant = 'standard'] = templateId.split('_') as [string, string | undefined]
      enemies.push(makeEnemy(`enemy_${dungeonId}_f${floorIndex}_${ex}_${ey}`, templateId, base, variant, room, ex, ey, 60 * floorIndex, 15 * floorIndex))
    }
  }

  // Stairs
  if (rooms.length >= 2) {
    const entrance = rooms[0]
    const exit = rooms[rooms.length - 1]
    tiles.set(`${entrance.x + 1}_${entrance.y + 1}`, { g: 'dungeon_stairs_up' })
    if (floorIndex < totalFloors) {
      tiles.set(`${exit.x + 1}_${exit.y + 1}`, { g: 'dungeon_stairs_down' })
    }
  }

  return { room, tiles, enemies }
}

function pickFloor1Enemy(rand: () => number): string {
  const table = ['skeleton', 'slime_weak', 'slime_corrosive', 'zombie', 'zombie_armoured'] as const
  return table[Math.floor(rand() * table.length)]
}

function pickFloor2Enemy(rand: () => number): string {
  const table = ['dark_knight_weak', 'dark_knight_elite', 'ghost', 'ghost_enraged', 'necromancer', 'necromancer_strong'] as const
  return table[Math.floor(rand() * table.length)]
}

function makeEnemy(
  id: string,
  templateId: string,
  baseType: string,
  variant: string,
  room: string,
  x: number,
  y: number,
  hp: number,
  power: number,
): EnemyInstance {
  return {
    id, templateId, baseType, variant,
    hp, maxHp: hp, mp: 0, maxMp: 0, power,
    room, x, y,
    spawnRoom: room, spawnX: x, spawnY: y,
    state: 'idle',
    executingPlayerId: null,
    lastLogicAt: 0,
    script: '# idle patrol script\npass',
    memory: {},
    carriedGold: 0,
  }
}
