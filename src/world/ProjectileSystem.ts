/**
 * ProjectileSystem — spawns, moves, and resolves physical and elemental projectiles
 * for both ranged (bow) and magic (staff/wand) attacks.
 *
 * Each projectile moves along a direction vector at a fixed speed. Collision is
 * checked against the tile collision map and against enemy tile positions each frame.
 * On hit, an onHit callback fires so GameScene can apply damage and status effects.
 *
 * Anti-double-hit: each projectile tracks a Set of enemy IDs it has already hit.
 * Physical arrows stop on first hit; elemental projectiles also stop (chain/pierce
 * variants can be added later without changing the core interface).
 */
import Phaser from 'phaser'
import { TILE_SIZE } from '../renderer/TilemapRenderer.ts'
import { isPassable } from './CollisionMap.ts'

export interface ProjectileHitEvent {
  projectileId: string
  enemyId: string
  damage: number
  crit: boolean
  element: 'fire' | 'water' | 'earth' | 'air' | null
  statusEffect?: { type: 'burn' | 'slow' | 'stagger' | 'chain'; durationMs: number; value: number }
  /** Pixel position of the hit — used for floating text placement. */
  px: number
  py: number
}

export interface EnemyTarget {
  id: string
  /** Tile coordinates of the enemy. */
  x: number
  y: number
}

interface ActiveProjectile {
  id: string
  ownerId: string
  px: number   // current pixel x
  py: number   // current pixel y
  dx: number   // unit direction x
  dy: number   // unit direction y
  speedPxPerSec: number
  maxRangePx: number
  traveledPx: number
  baseDamage: number
  crit: boolean
  element: 'fire' | 'water' | 'earth' | 'air' | null
  statusEffect?: { type: 'burn' | 'slow' | 'stagger' | 'chain'; durationMs: number; value: number }
  hitEnemyIds: Set<string>
  graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Arc
}

/** Pixel colour used to tint the projectile graphic per element. */
const ELEMENT_COLOR: Record<string, number> = {
  fire:    0xFF6600,
  water:   0x00CCFF,
  earth:   0x66BB44,
  air:     0xCCFFFF,
  default: 0xBB8833,  // physical arrow — brown
}

/** Pixel radius of the hit-test circle around an enemy's tile centre. */
const HIT_RADIUS_PX = TILE_SIZE * 0.65

export class ProjectileSystem {
  private _scene: Phaser.Scene
  private _projectiles = new Map<string, ActiveProjectile>()
  private _seq = 0

  constructor(scene: Phaser.Scene) {
    this._scene = scene
  }

  spawn(opts: {
    ownerId: string
    startPx: number
    startPy: number
    directionDx: number   // unit vector x (−1, 0, or 1)
    directionDy: number   // unit vector y (−1, 0, or 1)
    speedPxPerSec: number
    maxRangeTiles: number
    baseDamage: number
    crit: boolean
    element: ActiveProjectile['element']
    statusEffect?: ActiveProjectile['statusEffect']
    projectileSprite?: string  // Phaser texture key under Projectiles/
  }): string {
    const id = `${opts.ownerId}_${Date.now()}_${this._seq++}`

    // Use a loaded sprite image when available; fall back to a coloured circle.
    let graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Arc
    const spriteKey = opts.projectileSprite ? `Projectiles/${opts.projectileSprite}` : null
    if (spriteKey && this._scene.textures.exists(spriteKey)) {
      graphic = this._scene.add
        .image(opts.startPx, opts.startPy, spriteKey)
        .setDisplaySize(8, 8)
        .setDepth(15)
    } else {
      const color = ELEMENT_COLOR[opts.element ?? 'default'] ?? ELEMENT_COLOR['default']
      graphic = this._scene.add
        .arc(opts.startPx, opts.startPy, opts.element ? 4 : 3, 0, 360, false, color, 0.95)
        .setDepth(15)
    }

    const proj: ActiveProjectile = {
      id,
      ownerId: opts.ownerId,
      px: opts.startPx,
      py: opts.startPy,
      dx: opts.directionDx,
      dy: opts.directionDy,
      speedPxPerSec: opts.speedPxPerSec,
      maxRangePx: opts.maxRangeTiles * TILE_SIZE,
      traveledPx: 0,
      baseDamage: opts.baseDamage,
      crit: opts.crit,
      element: opts.element,
      statusEffect: opts.statusEffect,
      hitEnemyIds: new Set(),
      graphic,
    }

    this._projectiles.set(id, proj)
    return id
  }

  /**
   * Advance all live projectiles by `deltaMs` milliseconds. Enemy positions are
   * passed in as a snapshot; `onHit` fires for each collision.
   */
  update(
    deltaMs: number,
    enemies: EnemyTarget[],
    onHit: (evt: ProjectileHitEvent) => void,
  ): void {
    const deltaSec = deltaMs / 1000

    for (const [id, proj] of this._projectiles) {
      const movePx = proj.speedPxPerSec * deltaSec
      proj.px += proj.dx * movePx
      proj.py += proj.dy * movePx
      proj.traveledPx += movePx

      proj.graphic.setPosition(proj.px, proj.py)

      if (proj.traveledPx >= proj.maxRangePx) {
        this._destroy(id)
        continue
      }

      // Wall collision
      const tx = Math.floor(proj.px / TILE_SIZE)
      const ty = Math.floor(proj.py / TILE_SIZE)
      if (!isPassable(tx, ty)) {
        this._destroy(id)
        continue
      }

      // Enemy collision
      let hit = false
      for (const enemy of enemies) {
        if (proj.hitEnemyIds.has(enemy.id)) continue

        const ecx = enemy.x * TILE_SIZE + TILE_SIZE / 2
        const ecy = enemy.y * TILE_SIZE + TILE_SIZE / 2
        if (Math.hypot(proj.px - ecx, proj.py - ecy) < HIT_RADIUS_PX) {
          proj.hitEnemyIds.add(enemy.id)
          onHit({
            projectileId: id,
            enemyId: enemy.id,
            damage: proj.baseDamage,
            crit: proj.crit,
            element: proj.element,
            statusEffect: proj.statusEffect,
            px: proj.px,
            py: proj.py,
          })
          // All projectile types stop on first hit (pierce variants can be added later)
          hit = true
          break
        }
      }

      if (hit) this._destroy(id)
    }
  }

  /** Remove all active projectiles (e.g. on room transition or scene shutdown). */
  destroyAll(): void {
    for (const id of [...this._projectiles.keys()]) this._destroy(id)
  }

  private _destroy(id: string): void {
    const proj = this._projectiles.get(id)
    if (!proj) return
    if (proj.graphic.active) proj.graphic.destroy()
    this._projectiles.delete(id)
  }
}
