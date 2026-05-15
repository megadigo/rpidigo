/**
 * RoadNetwork — pre-computed road paths between all POIs.
 * Pure in-memory computation, no Firebase.  Called once at startup from WorldBootstrap.
 * Roads are stamped into chunks at chunk-generation time.
 */
import type { PoiLayout, PoiEntry } from './types.ts'
import { tileKey } from './utils.ts'

export interface RoadPath {
  tiles: Array<{ x: number; y: number }>
}

export interface RoadNetwork {
  /** Set of `tileKey(x,y)` road tiles across the whole world. */
  tileSet: Set<string>
  paths: RoadPath[]
}

/**
 * Build axis-aligned (L-shaped) roads between every village and its nearest dungeon.
 */
export function buildRoadNetwork(pois: PoiLayout): RoadNetwork {
  const paths: RoadPath[] = []
  const tileSet = new Set<string>()

  for (const village of pois.villages) {
    // Find nearest dungeon in the same or adjacent sector
    let nearestDungeon: PoiEntry = pois.dungeons[0]
    let nearestDist = Infinity
    for (const dungeon of pois.dungeons) {
      const dist = Math.abs(dungeon.x - village.x) + Math.abs(dungeon.y - village.y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestDungeon = dungeon
      }
    }
    const path = buildLPath(village.x, village.y, nearestDungeon.x, nearestDungeon.y)
    paths.push(path)
    for (const t of path.tiles) tileSet.add(tileKey(t.x, t.y))
  }

  // Also connect each village to its two nearest neighbours (world backbone)
  for (let i = 0; i < pois.villages.length; i++) {
    const va = pois.villages[i]
    const sorted = pois.villages
      .filter((_, j) => j !== i)
      .sort((a, b) =>
        Math.abs(a.x - va.x) + Math.abs(a.y - va.y) -
        (Math.abs(b.x - va.x) + Math.abs(b.y - va.y)),
      )
    for (const vb of sorted.slice(0, 2)) {
      // Only add if not already covered (simple dedup by direction)
      if (va.id < vb.id) {
        const path = buildLPath(va.x, va.y, vb.x, vb.y)
        paths.push(path)
        for (const t of path.tiles) tileSet.add(tileKey(t.x, t.y))
      }
    }
  }

  return { tileSet, paths }
}

/** Trace a single-tile-wide L-shaped road: horizontal first, then vertical. */
function buildLPath(x1: number, y1: number, x2: number, y2: number): RoadPath {
  const tiles: Array<{ x: number; y: number }> = []
  const dx = x2 > x1 ? 1 : -1
  const dy = y2 > y1 ? 1 : -1
  for (let x = x1; x !== x2; x += dx) tiles.push({ x, y: y1 })
  for (let y = y1; y !== y2 + dy; y += dy) tiles.push({ x: x2, y })
  return { tiles }
}
