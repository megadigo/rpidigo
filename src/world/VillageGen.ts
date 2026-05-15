/**
 * VillageGen — stamps a structured village layout onto a tile map.
 *
 * Houses are now single-sprite tiles (house_hut, house_cabin, barracks, chapel,
 * tavern, workshop) instead of multi-tile wall/roof/door structures.  Each placed
 * building tile stores its world position so HouseGen can derive the room ID
 * deterministically as `house_${tx}_${ty}`.
 *
 * Village layout:
 *   • Central well on 5×5 cobblestone square
 *   • Market stall + quest board at square corners
 *   • 4 cobblestone arms, 3 tiles wide, 12-18 tiles each
 *   • Buildings on BOTH sides of each arm at 3 evenly-spaced slots
 *     (special buildings first: tavern, barracks, chapel, workshop;
 *      then houses — huts and cabins — fill remaining positions)
 *   • Street signs at path ends
 *   • Tombstone cluster away from centre
 *   • Two wheat-field patches with stump borders
 */
import type { TileData, NpcInstance } from './types.ts'
import { mulberry32, seededRandInt, tileKey } from './utils.ts'

export interface VillageLayout {
  tiles: Map<string, TileData>   // key `${x}_${y}`
  npcs: NpcInstance[]
  /** World positions of every building tile that has an interior room. */
  buildingPositions: Array<{ x: number; y: number; type: string }>
}

export function generateVillage(
  villageId: string,
  originX: number,
  originY: number,
  seed: number,
): VillageLayout {
  const rand = mulberry32(seed ^ 0xdeadbeef)
  const tiles = new Map<string, TileData>()
  const npcs: NpcInstance[] = []
  const buildingPositions: Array<{ x: number; y: number; type: string }> = []

  /** Place a ground tile at (x, y). */
  function ground(x: number, y: number, g: string) {
    tiles.set(tileKey(x, y), { g })
  }

  /** Place a MIDDLE object on a cobblestone ground at (x, y). */
  function object(x: number, y: number, type: string) {
    if (!tiles.has(tileKey(x, y))) ground(x, y, 'cobblestone')
    const entry = tiles.get(tileKey(x, y))!
    tiles.set(tileKey(x, y), { ...entry, m: [...(entry.m ?? []), type] })
    const hasInterior = ['house_hut', 'house_cabin', 'barracks', 'chapel', 'tavern', 'workshop']
    if (hasInterior.includes(type)) buildingPositions.push({ x, y, type })
  }

  // ── Central cobblestone square (5×5) ────────────────────────────────────
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      ground(originX + dx, originY + dy, 'cobblestone')
    }
  }
  object(originX, originY, 'well')
  object(originX + 2, originY - 2, 'market_stall')
  object(originX - 2, originY - 2, 'quest_board')

  // ── 4 path arms — 3 tiles wide ────────────────────────────────────────
  const pathLengths = [
    seededRandInt(rand, 12, 18),
    seededRandInt(rand, 12, 18),
    seededRandInt(rand, 12, 18),
    seededRandInt(rand, 12, 18),
  ]
  const dirs = [
    { dx: 1,  dy: 0  },
    { dx: -1, dy: 0  },
    { dx: 0,  dy: 1  },
    { dx: 0,  dy: -1 },
  ]

  for (let d = 0; d < 4; d++) {
    const { dx, dy } = dirs[d]
    const pl = pathLengths[d]
    // Perpendicular unit vector (non-zero axis swapped)
    const px = dy !== 0 ? 1 : 0
    const py = dx !== 0 ? 1 : 0
    for (let i = 1; i <= pl; i++) {
      ground(originX + dx * i,      originY + dy * i,      'cobblestone')
      ground(originX + dx * i + px, originY + dy * i + py, 'cobblestone')
      ground(originX + dx * i - px, originY + dy * i - py, 'cobblestone')
    }
    // Street sign at path end (centre tile)
    object(originX + dx * pl, originY + dy * pl, 'street_sign')
  }

  // ── Buildings on both sides of each arm ─────────────────────────────────
  // Special buildings placed first (1 of each), then houses fill remaining slots
  const specialPool = ['tavern', 'barracks', 'chapel', 'workshop']
  let specialIdx = 0
  const housePool = ['house_hut', 'house_cabin', 'house_hut', 'house_cabin', 'house_hut', 'house_cabin']
  let houseIdx = 0
  const usedPositions = new Set<string>()

  for (let d = 0; d < 4; d++) {
    const { dx, dy } = dirs[d]
    const pl = pathLengths[d]
    const px = dy !== 0 ? 1 : 0
    const py = dx !== 0 ? 1 : 0
    // 3 building slots at ~25%, ~50%, ~80% of arm length
    const slots = [
      Math.max(3, Math.floor(pl * 0.25)),
      Math.max(5, Math.floor(pl * 0.5)),
      Math.max(7, Math.floor(pl * 0.8)),
    ]
    for (const slot of slots) {
      for (const side of [-1, 1]) {
        // Building is 3 tiles perpendicular from the path centre
        const bx = originX + dx * slot + px * side * 3
        const by = originY + dy * slot + py * side * 3
        const posKey = `${bx}_${by}`
        if (usedPositions.has(posKey)) continue
        usedPositions.add(posKey)
        const type = specialIdx < specialPool.length
          ? specialPool[specialIdx++]
          : housePool[houseIdx++ % housePool.length]
        object(bx, by, type)
        // 1-tile cobblestone connector bridging path edge (±1) to building (±3)
        ground(
          originX + dx * slot + px * side * 2,
          originY + dy * slot + py * side * 2,
          'cobblestone',
        )
      }
    }
  }

  // ── Tombstone cluster ────────────────────────────────────────────────────
  const tombX = originX + seededRandInt(rand, -18, -12)
  const tombY = originY + seededRandInt(rand, -18, -12)
  const tombCount = seededRandInt(rand, 3, 6)
  for (let i = 0; i < tombCount; i++) {
    const tx = tombX + seededRandInt(rand, -2, 2)
    const ty = tombY + seededRandInt(rand, -2, 2)
    if (!tiles.has(tileKey(tx, ty))) object(tx, ty, 'tombstone')
  }

  // ── Wheat fields — 2 rectangular patches ────────────────────────────────
  const fieldOffsets = [
    { ox: seededRandInt(rand, 10, 16),   oy: seededRandInt(rand, 4, 8)   },
    { ox: seededRandInt(rand, -16, -10), oy: seededRandInt(rand, -8, -4) },
  ]
  for (const { ox, oy } of fieldOffsets) {
    const fw = seededRandInt(rand, 4, 7)
    const fh = seededRandInt(rand, 3, 5)
    for (let fx = 0; fx < fw; fx++) {
      for (let fy = 0; fy < fh; fy++) {
        const wx = originX + ox + fx
        const wy = originY + oy + fy
        tiles.set(tileKey(wx, wy), { g: 'garden_plot', m: ['wheat_field'] })
      }
    }
    for (let fx = -1; fx <= fw; fx++) {
      object(originX + ox + fx, originY + oy - 1,  'stump')
      object(originX + ox + fx, originY + oy + fh, 'stump')
    }
    for (let fy = 0; fy < fh; fy++) {
      object(originX + ox - 1,  originY + oy + fy, 'stump')
      object(originX + ox + fw, originY + oy + fy, 'stump')
    }
  }

  // ── NPCs ─────────────────────────────────────────────────────────────────
  const villagerProfiles = ['villager_wanderer', 'villager_gossiper', 'villager_fisherman', 'villager_hunter']
  const villagerCount = seededRandInt(rand, 3, 5)
  for (let i = 0; i < villagerCount; i++) {
    const profile = villagerProfiles[i % villagerProfiles.length]
    const nx = originX + seededRandInt(rand, -5, 5)
    const ny = originY + seededRandInt(rand, -5, 5)
    npcs.push(makeNpc(`npc_${villageId}_${i}`, profile, 'villager', profile.replace('villager_', ''), nx, ny, villageId))
  }
  npcs.push(makeNpc(`npc_${villageId}_merchant`, 'merchant_standard', 'merchant', 'standard', originX + 2, originY - 2, villageId))
  const guardCount = seededRandInt(rand, 1, 2)
  for (let g = 0; g < guardCount; g++) {
    const gx = originX + dirs[g].dx * (pathLengths[g] - 1)
    const gy = originY + dirs[g].dy * (pathLengths[g] - 1)
    npcs.push(makeNpc(`npc_${villageId}_guard_${g}`, 'guard_patrol', 'guard', 'patrol', gx, gy, villageId))
  }

  return { tiles, npcs, buildingPositions }
}

function makeNpc(
  id: string,
  templateId: string,
  baseType: string,
  variant: string,
  x: number,
  y: number,
  villageId: string,
): NpcInstance {
  return {
    id,
    templateId,
    baseType,
    variant,
    hp: 80, maxHp: 80, mp: 0, maxMp: 0, power: 0,
    room: '0', x, y, homeX: x, homeY: y,
    villageId,
    zoneId: 'plains',
    state: 'idle',
    executingPlayerId: null,
    lastLogicAt: 0,
    script: '# idle patrol script\npass',
    memory: {},
  }
}



