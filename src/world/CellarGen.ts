/**
 * CellarGen — generates small cellar dungeons attached to some houses.
 * Room key: `cellar_{tx}_{ty}` where (tx, ty) is the source house tile.
 *
 * Each cellar is scattered with 8–13 destructible barrels/boxes (occasional
 * loot on break) and infested with 2–4 aggressive rats that actively chase
 * the player (patrol_chase) rather than fleeing.
 */
import type { TileData, EnemyInstance } from './types.ts'
import { mulberry32, seededRandInt, tileKey, rollEnemyInitialCarriedGold } from './utils.ts'
import { EnemyRegistry } from '../registry/registries.ts'
import patrolChase from '../scripts/enemies/patrol_chase.py?raw'

export const CELLAR_ROOM_SIZE = 20
const CHEST_SPAWN_PROBABILITY = 0.7

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export function cellarRoomId(tx: number, ty: number): string {
  return `cellar_${pad4(tx)}_${pad4(ty)}`
}

export function parseCellarRoomId(roomId: string): { tx: number; ty: number } | null {
  const m = /^cellar_(\d{4})_(\d{4})$/.exec(roomId)
  if (!m) return null
  return { tx: parseInt(m[1], 10), ty: parseInt(m[2], 10) }
}

export interface CellarRoom {
  roomId:  string
  tiles:   Map<string, TileData>
  enemies: EnemyInstance[]
}

export function generateCellarRoom(tx: number, ty: number, seed: number): CellarRoom {
  const roomId  = cellarRoomId(tx, ty)
  const rand    = mulberry32(seed ^ (tx * 1103515245) ^ (ty * 12345))
  const S       = CELLAR_ROOM_SIZE
  const tiles   = new Map<string, TileData>()
  const enemies: EnemyInstance[] = []

  // Base: solid room with border walls
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) {
      const isBorder = x === 0 || y === 0 || x === S - 1 || y === S - 1
      tiles.set(tileKey(x, y), isBorder
        ? { g: 'cellar_floor', m: ['cellar_wall'] }
        : { g: 'cellar_floor' })
    }
  }

  // Carve a few inner wall clusters to make it feel dungeon-like.
  const clusters = 4 + seededRandInt(rand, 0, 2)
  for (let i = 0; i < clusters; i++) {
    const cx = seededRandInt(rand, 3, S - 4)
    const cy = seededRandInt(rand, 3, S - 4)
    const w  = seededRandInt(rand, 2, 4)
    const h  = seededRandInt(rand, 2, 4)
    for (let x = cx; x < Math.min(S - 1, cx + w); x++) {
      for (let y = cy; y < Math.min(S - 1, cy + h); y++) {
        tiles.set(tileKey(x, y), { g: 'cellar_floor', m: ['cellar_wall'] })
      }
    }
  }

  // Entry back to house near the north-west corner.
  const upX = 2
  const upY = 2
  tiles.set(tileKey(upX, upY), { g: 'cellar_stairs_up' })
  tiles.set(tileKey(upX + 1, upY), { g: 'cellar_floor' })
  tiles.set(tileKey(upX, upY + 1), { g: 'cellar_floor' })

  // Optional loot details.
  if (rand() < CHEST_SPAWN_PROBABILITY) {
    const chestX = seededRandInt(rand, 2, S - 3)
    const chestY = seededRandInt(rand, 2, S - 3)
    if (chestX !== upX || chestY !== upY) {
      const cItems: Array<{itemId: string; quantity: number}> = []
      if (rand() < 0.6) cItems.push({ itemId: 'mushroom_item', quantity: seededRandInt(rand, 1, 3) })
      if (rand() < 0.5) cItems.push({ itemId: 'health_potion', quantity: 1 })
      if (rand() < 0.3) cItems.push({ itemId: 'antidote',      quantity: 1 })
      tiles.set(tileKey(chestX, chestY), {
        g: 'cellar_floor',
        m: ['cellar_chest'],
        metadata: { gold: seededRandInt(rand, 8, 35), items: cItems },
      })
    }
  }
  // Scatter barrels and boxes throughout the cellar — destructible containers
  // (press A to break) that sometimes yield gold, materials, or potions.
  const containerCount = 8 + seededRandInt(rand, 0, 5) // 8-13
  for (let i = 0; i < containerCount; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bx = seededRandInt(rand, 1, S - 2)
      const by = seededRandInt(rand, 1, S - 2)
      if (Math.abs(bx - upX) <= 1 && Math.abs(by - upY) <= 1) continue // keep entry clear
      const k = tileKey(bx, by)
      const existing = tiles.get(k)
      if (existing?.g === 'cellar_floor' && !existing.m?.length) {
        const containerType = rand() < 0.5 ? 'cellar_barrel' : 'cellar_box'
        tiles.set(k, { g: 'cellar_floor', m: [containerType] })
        break
      }
    }
  }

  // Rat infestation — 2 to 4 rats at random free interior positions.
  const ratCount = 2 + seededRandInt(rand, 0, 2)
  for (let i = 0; i < ratCount; i++) {
    // Pick a free floor tile (no middle layer occupied).
    for (let attempt = 0; attempt < 40; attempt++) {
      const rx = seededRandInt(rand, 1, S - 2)
      const ry = seededRandInt(rand, 1, S - 2)
      const existing = tiles.get(tileKey(rx, ry))
      if (existing?.g === 'cellar_floor' && !existing.m?.length) {
        const ratId = `cellar_${pad4(tx)}_${pad4(ty)}_rat_${i}`
        enemies.push(_makeRat(ratId, roomId, rx, ry))
        break
      }
    }
  }

  return { roomId, tiles, enemies }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _makeRat(id: string, room: string, x: number, y: number): EnemyInstance {
  let carriedGold = 0
  try { carriedGold = rollEnemyInitialCarriedGold(EnemyRegistry.get('rat_weak').lootTable) } catch { /* fallback */ }
  return {
    id, templateId: 'rat_weak', baseType: 'rat', variant: 'weak',
    hp: 12, maxHp: 12, mp: 0, maxMp: 0, power: 2,
    room, x, y, spawnRoom: room, spawnX: x, spawnY: y,
    state: 'idle',
    executingPlayerId: null,
    lastLogicAt: 0,
    // Cellar rats are more aggressive than overworld rats (which use
    // patrol_flee and run away): they actively hunt the player on sight.
    script: patrolChase,
    memory: {},
    carriedGold,
  }
}
