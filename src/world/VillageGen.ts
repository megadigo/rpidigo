/**
 * VillageGen — stamps a structured village layout onto a tile map.
 * Called from ChunkGen when generating a chunk that contains a village POI.
 */
import type { TileData, NpcInstance } from './types.ts'
import { mulberry32, seededRandInt } from './utils.ts'

export interface VillageLayout {
  tiles: Map<string, TileData>   // key `${x}_${y}`
  npcs: NpcInstance[]
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

  /**
   * Set a tile with automatic layer assignment:
   * - GROUND types (cobblestone, house_floor, garden_plot) go in `g`.
   * - MIDDLE objects (well, fence, walls, furniture…) go in `m` with cobblestone ground.
   * - Interior flag adds a `t: 'house_roof'` TOP layer.
   */
  function set(x: number, y: number, type: string, interior = false) {
    const GROUND_TYPES = new Set(['cobblestone', 'house_floor', 'garden_plot', 'dungeon_entrance'])
    let entry: TileData
    if (GROUND_TYPES.has(type)) {
      entry = interior ? { g: type, t: 'house_roof' } : { g: type }
    } else {
      // MIDDLE object — put on cobblestone ground
      entry = interior ? { g: 'cobblestone', m: [type], t: 'house_roof' } : { g: 'cobblestone', m: [type] }
    }
    tiles.set(`${x}_${y}`, entry)
  }

  // Central well
  set(originX, originY, 'well')

  // Cobblestone paths in 4 cardinal directions
  const pathLengths = [
    seededRandInt(rand, 6, 10),
    seededRandInt(rand, 6, 10),
    seededRandInt(rand, 6, 10),
    seededRandInt(rand, 6, 10),
  ]
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ]
  for (let d = 0; d < 4; d++) {
    for (let i = 1; i <= pathLengths[d]; i++) {
      set(originX + dirs[d].dx * i, originY + dirs[d].dy * i, 'cobblestone')
    }
  }

  // Buildings along paths
  const buildingCount = seededRandInt(rand, 3, 8)
  for (let b = 0; b < buildingCount; b++) {
    const dirIdx = b % 4
    const { dx, dy } = dirs[dirIdx]
    const offset = seededRandInt(rand, 2, pathLengths[dirIdx] - 1)
    const bx = originX + dx * offset + (dy !== 0 ? seededRandInt(rand, 1, 2) : 0)
    const by = originY + dy * offset + (dx !== 0 ? seededRandInt(rand, 1, 2) : 0)
    const bw = seededRandInt(rand, 5, 8)
    const bh = seededRandInt(rand, 4, 6)
    // Walls and door
    for (let wx = bx; wx < bx + bw; wx++) {
      for (let wy = by; wy < by + bh; wy++) {
        const isWall = wx === bx || wx === bx + bw - 1 || wy === by || wy === by + bh - 1
        if (isWall) {
          set(wx, wy, 'house_wall')
        } else {
          // Interior floor with roof cover (TOP layer hides player inside)
          set(wx, wy, 'house_floor', true)
        }
      }
    }
    // Door facing path
    const doorX = bx + Math.floor(bw / 2)
    const doorY = dy >= 0 ? by : by + bh - 1
    set(doorX, doorY, 'house_door')
  }

  // Forge and market stall near central square
  set(originX + 2, originY + 2, 'blacksmith_forge')
  set(originX - 2, originY + 2, 'market_stall')

  // Decoration scatter
  const decorTiles = ['fence', 'lantern', 'garden_plot']
  for (let i = 0; i < 8; i++) {
    const ox = seededRandInt(rand, -5, 5)
    const oy = seededRandInt(rand, -5, 5)
    const type = decorTiles[seededRandInt(rand, 0, decorTiles.length - 1)]
    const key = `${originX + ox}_${originY + oy}`
    if (!tiles.has(key)) set(originX + ox, originY + oy, type)
  }

  // NPC profiles to spawn
  const villagerProfiles = ['villager_wanderer', 'villager_gossiper', 'villager_fisherman', 'villager_hunter']
  const villagerCount = seededRandInt(rand, 2, 4)
  for (let i = 0; i < villagerCount; i++) {
    const profile = villagerProfiles[i % villagerProfiles.length]
    const nx = originX + seededRandInt(rand, -4, 4)
    const ny = originY + seededRandInt(rand, -4, 4)
    npcs.push(makeNpc(`npc_${villageId}_${i}`, profile, 'villager', profile.replace('villager_', ''), nx, ny, villageId))
  }
  // Merchant
  npcs.push(makeNpc(`npc_${villageId}_merchant`, 'merchant_standard', 'merchant', 'standard', originX - 2, originY + 2, villageId))
  // Guards
  const guardCount = seededRandInt(rand, 1, 2)
  for (let g = 0; g < guardCount; g++) {
    const gx = originX + dirs[g].dx * (pathLengths[g] - 1)
    const gy = originY + dirs[g].dy * (pathLengths[g] - 1)
    npcs.push(makeNpc(`npc_${villageId}_guard_${g}`, 'guard_patrol', 'guard', 'patrol', gx, gy, villageId))
  }

  return { tiles, npcs }
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
