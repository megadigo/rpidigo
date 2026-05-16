/**
 * HouseGen — generates a randomised interior room for each house sprite.
 *
 * Each building tile (house_hut, house_cabin, barracks, chapel, tavern, workshop)
 * at overworld position (tx, ty) gets a unique 8×8 interior room:
 *
 *   Border    : dungeon_wall (impassable)
 *   Inner     : house_floor
 *   house_exit at (4, 7) — centre-bottom of the south wall
 *   Furniture : seeded-random positions, themed per building type
 *
 * The room ID doubles as the Firebase room key under `map/{roomId}`.
 */
import type { TileData } from './types.ts'
import { mulberry32, seededRandInt, tileKey } from './utils.ts'

export const HOUSE_ROOM_SIZE = 8

/** Zero-pad a world coordinate to 4 digits, e.g. 42 → '0042'. */
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/**
 * Derive the interior room ID from the overworld tile position of the building.
 * This is deterministic and does NOT require storing it in tile metadata.
 */
export function houseRoomId(tx: number, ty: number): string {
  return `house_${pad4(tx)}_${pad4(ty)}`
}

/** Tile layout for a single house interior. */
export interface HouseRoom {
  roomId: string
  tiles: Map<string, TileData>
  hasCellar: boolean
}

/**
 * Generate the interior room for the building at overworld tile (tx, ty).
 * `seed` is the world seed XOR'd with the tile position for variety.
 * `buildingType` drives the furniture theme; positions are seeded-random.
 */
export function generateHouseRoom(
  tx: number,
  ty: number,
  seed: number,
  buildingType: string,
): HouseRoom {
  const roomId = houseRoomId(tx, ty)
  const rand = mulberry32(seed ^ (tx * 73856093) ^ (ty * 19349663))
  const tiles = new Map<string, TileData>()
  const S = HOUSE_ROOM_SIZE

  // Fill interior with house_floor
  for (let x = 0; x < S; x++)
    for (let y = 0; y < S; y++)
      tiles.set(tileKey(x, y), { g: 'house_floor' })

  // Border walls
  for (let x = 0; x < S; x++) {
    tiles.set(tileKey(x, 0),     { g: 'house_floor', m: ['dungeon_wall'] })
    tiles.set(tileKey(x, S - 1), { g: 'house_floor', m: ['dungeon_wall'] })
  }
  for (let y = 1; y < S - 1; y++) {
    tiles.set(tileKey(0, y),     { g: 'house_floor', m: ['dungeon_wall'] })
    tiles.set(tileKey(S - 1, y), { g: 'house_floor', m: ['dungeon_wall'] })
  }

  // Door — centre of south wall
  const portalX = Math.floor(S / 2)
  const portalY = S - 1
  tiles.set(tileKey(portalX, portalY), { g: 'house_floor', m: ['house_exit'] })

  // ── Furniture placement helpers ──────────────────────────────────────────

  /** All occupied interior positions (walls + portal + spawn path). */
  const occupied = new Set<string>()
  occupied.add(tileKey(portalX, portalY))           // exit tile
  occupied.add(tileKey(portalX, portalY - 1))       // tile in front of exit (row S-2)
  const spawnTileX = Math.floor(S / 2)
  const spawnTileY = S - 3
  occupied.add(tileKey(spawnTileX, spawnTileY))     // player spawn position
  occupied.add(tileKey(spawnTileX, spawnTileY - 1)) // one tile above spawn (walkway)

  /**
   * Place one furniture item at a random free position.
   * Candidates: x in [minX, maxX], y in [minY, maxY].
   * Returns true if placed successfully within maxAttempts.
   */
  function place(
    item: string,
    minX = 1, maxX = S - 2,
    minY = 1, maxY = S - 4,   // S-4 = row 8 max — keeps furniture clear of spawn row (S-3) and below
    metadata?: Record<string, unknown>,
  ): boolean {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = seededRandInt(rand, minX, maxX)
      const y = seededRandInt(rand, minY, maxY)
      const k = tileKey(x, y)
      if (!occupied.has(k)) {
        occupied.add(k)
        tiles.set(k, metadata
          ? { g: 'house_floor', m: [item], metadata }
          : { g: 'house_floor', m: [item] })
        return true
      }
    }
    return false
  }

  // ── Themed layouts ────────────────────────────────────────────────────────

  switch (buildingType) {

    case 'workshop': {
      // 2–3 workbenches in the upper half, 1 chest
      const benches = 2 + (rand() < 0.5 ? 1 : 0)
      for (let i = 0; i < benches; i++) place('workbench', 1, S - 2, 1, Math.floor(S / 2) - 1)
      place('chest', 1, S - 2, 1, S - 4)
      // Optional extra table
      if (rand() < 0.4) place('table', 1, S - 2, 1, S - 4)
      break
    }

    case 'barracks': {
      // Quest board near top-centre, 2–3 chests around the room
      place('quest_board', 2, S - 3, 1, 3)
      const chests = 2 + (rand() < 0.4 ? 1 : 0)
      for (let i = 0; i < chests; i++)
        place('chest', 1, S - 2, 1, S - 4)
      // Occasional table (briefing table)
      if (rand() < 0.5) place('table', 1, S - 2, Math.floor(S / 3), S - 4)
      break
    }

    case 'chapel': {
      // Altar fixed near top-centre, 1–2 chests, optional sofa
      const altarX = seededRandInt(rand, 2, S - 3)
      const altarK = tileKey(altarX, 2)
      occupied.add(altarK)
      tiles.set(altarK, { g: 'house_floor', m: ['dungeon_altar'] })
      const chests = 1 + (rand() < 0.6 ? 1 : 0)
      for (let i = 0; i < chests; i++) place('chest', 1, S - 2, 2, S - 4)
      if (rand() < 0.4) place('sofa', 1, S - 2, Math.floor(S / 2), S - 4)
      break
    }

    case 'tavern': {
      // Tables and sofas fill the middle; chest in a corner
      const tables = 2 + seededRandInt(rand, 0, 2)
      for (let i = 0; i < tables; i++) place('table', 2, S - 3, 2, S - 4)
      const sofas = 1 + (rand() < 0.5 ? 1 : 0)
      for (let i = 0; i < sofas; i++) place('sofa', 2, S - 3, 2, S - 4)
      place('chest', 1, S - 2, 1, S - 4,
        { gold: seededRandInt(rand, 5, 25) })
      break
    }

    default: {
      // house_hut / house_cabin — residential: bed, maybe sofa/table, chest
      place('bed', 1, S - 2, 1, 4)
      if (rand() < 0.6) place(rand() < 0.5 ? 'table' : 'sofa', 1, S - 2, 2, S - 4)
      if (rand() < 0.35) place('sofa', 1, S - 2, 2, S - 4)
      place('chest', 1, S - 2, 1, S - 4,
        { gold: seededRandInt(rand, 10, 50) })
      break
    }
  }

  // Some residential houses get a cellar stairs-down tile.
  // Keep this after furniture so the stair lands in a truly free spot.
  const isResidential = buildingType === 'house_hut' || buildingType === 'house_cabin'
  const hasCellar = isResidential && rand() < 0.4
  if (hasCellar) {
    place('dungeon_stairs_down', 1, S - 2, 1, S - 4)
  }

  return { roomId, tiles, hasCellar }
}
