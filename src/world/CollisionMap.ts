/**
 * CollisionMap — tile passability queries backed by ChunkManager's in-memory cache.
 * Passability and speed data are sourced from TILE_DEFS in TilemapRenderer.
 * All layers (g, m) are checked: any impassable layer blocks movement.
 */
import { getTile } from './ChunkManager.ts'
import { isTileImpassable, getTileSpeedMod } from '../renderer/TilemapRenderer.ts'

/** Returns false for tiles not yet loaded or out of bounds [0, 999]. */
export function isPassable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= 1000 || y >= 1000) return false
  const tile = getTile(x, y)
  if (!tile) return false   // chunk not yet loaded → treat as blocked
  if (isTileImpassable(tile.g)) return false
  if (tile.m?.some(m => isTileImpassable(m))) return false
  return true
}

/** Returns the slowest speed multiplier across all layers (1.0 = normal). */
export function getSpeedMod(x: number, y: number): number {
  const tile = getTile(x, y)
  if (!tile) return 1.0
  let mod = getTileSpeedMod(tile.g)
  if (tile.m) for (const m of tile.m) mod = Math.min(mod, getTileSpeedMod(m))
  return mod
}
