/** Directional walk animation helpers — shared by all entity renderers. */

/** The four cardinal facing directions. Row order matches MiniWorldSprites layout. */
export type Direction = 'down' | 'up' | 'right' | 'left'

/** Spritesheet row index for each direction (5 frames per row, 16×16 px). */
export const ANIM_ROWS: Record<Direction, number> = { down: 0, up: 1, right: 2, left: 3 }

/** Number of walk-cycle frames per direction row. */
export const ANIM_FRAMES = 5

/** Milliseconds to display each walk frame before advancing. */
export const FRAME_DURATION_MS = 120

/**
 * Returns the flat spritesheet frame index for a given direction and cycle frame.
 * Frame 0 (down, frameIndex 0) is the idle/portrait frame used on the login screen.
 */
export function getFrame(dir: Direction, frameIndex: number): number {
  return ANIM_ROWS[dir] * ANIM_FRAMES + frameIndex
}

/**
 * Derives the facing direction from a velocity vector.
 * Prefers the vertical axis on diagonals.
 * Falls back to `fallback` when both components are zero (idle).
 */
export function directionFromVelocity(vx: number, vy: number, fallback: Direction = 'down'): Direction {
  if (vx === 0 && vy === 0) return fallback
  if (Math.abs(vy) >= Math.abs(vx)) return vy > 0 ? 'down' : 'up'
  return vx > 0 ? 'right' : 'left'
}
