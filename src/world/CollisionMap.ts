/**
 * CollisionMap — tile passability queries backed by ChunkManager's in-memory cache.
 */
import { getTile } from './ChunkManager.ts'

const IMPASSABLE = new Set([
  'tree_oak', 'tree_pine', 'tree_dead',
  'rock_small', 'rock_large', 'moss_rock',
  'cactus',
  'water_shallow', 'water_deep', 'oasis_water',
  'house_wall', 'dungeon_wall', 'dungeon_pillar',
  'fence', 'well', 'void',
])

const SPEED_MOD: Record<string, number> = {
  grass_tall: 0.6,
  mud: 0.5,
  quicksand: 0.4,
  sand_dune: 0.7,
}

/** Returns false for tiles not yet loaded or out of bounds [0, 999]. */
export function isPassable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= 1000 || y >= 1000) return false
  const tile = getTile(x, y)
  if (!tile) return false          // chunk not yet loaded → treat as blocked
  return !IMPASSABLE.has(tile.type)
}

/** Returns the speed multiplier for a tile (1.0 = normal, <1 = slower). */
export function getSpeedMod(x: number, y: number): number {
  const tile = getTile(x, y)
  if (!tile) return 1.0
  return SPEED_MOD[tile.type] ?? 1.0
}
