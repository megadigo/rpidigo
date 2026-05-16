/**
 * CellarGen — generates small cellar dungeons attached to some houses.
 * Room key: `cellar_{tx}_{ty}` where (tx, ty) is the source house tile.
 */
import type { TileData } from './types.ts'
import { mulberry32, seededRandInt, tileKey } from './utils.ts'

export const CELLAR_ROOM_SIZE = 20

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
  roomId: string
  tiles: Map<string, TileData>
}

export function generateCellarRoom(tx: number, ty: number, seed: number): CellarRoom {
  const roomId = cellarRoomId(tx, ty)
  const rand = mulberry32(seed ^ (tx * 1103515245) ^ (ty * 12345))
  const S = CELLAR_ROOM_SIZE
  const tiles = new Map<string, TileData>()

  // Base: solid room with border walls
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) {
      const isBorder = x === 0 || y === 0 || x === S - 1 || y === S - 1
      tiles.set(tileKey(x, y), isBorder
        ? { g: 'dungeon_floor', m: ['dungeon_wall'] }
        : { g: 'dungeon_floor' })
    }
  }

  // Carve a few inner wall clusters to make it feel dungeon-like.
  const clusters = 4 + seededRandInt(rand, 0, 2)
  for (let i = 0; i < clusters; i++) {
    const cx = seededRandInt(rand, 3, S - 4)
    const cy = seededRandInt(rand, 3, S - 4)
    const w = seededRandInt(rand, 2, 4)
    const h = seededRandInt(rand, 2, 4)
    for (let x = cx; x < Math.min(S - 1, cx + w); x++) {
      for (let y = cy; y < Math.min(S - 1, cy + h); y++) {
        tiles.set(tileKey(x, y), { g: 'dungeon_floor', m: ['dungeon_wall'] })
      }
    }
  }

  // Entry back to house near the north-west corner.
  const upX = 2
  const upY = 2
  tiles.set(tileKey(upX, upY), { g: 'dungeon_stairs_up' })
  tiles.set(tileKey(upX + 1, upY), { g: 'dungeon_floor' })
  tiles.set(tileKey(upX, upY + 1), { g: 'dungeon_floor' })

  // Optional loot/trap details.
  if (rand() < 0.7) {
    const chestX = seededRandInt(rand, 2, S - 3)
    const chestY = seededRandInt(rand, 2, S - 3)
    if (chestX !== upX || chestY !== upY) {
      tiles.set(tileKey(chestX, chestY), {
        g: 'dungeon_floor',
        m: ['dungeon_chest'],
        metadata: { gold: seededRandInt(rand, 8, 35) },
      })
    }
  }
  if (rand() < 0.4) {
    const trapX = seededRandInt(rand, 2, S - 3)
    const trapY = seededRandInt(rand, 2, S - 3)
    if ((trapX !== upX || trapY !== upY) && tiles.get(tileKey(trapX, trapY))?.m?.[0] !== 'dungeon_chest') {
      tiles.set(tileKey(trapX, trapY), { g: 'dungeon_trap' })
    }
  }

  return { roomId, tiles }
}
