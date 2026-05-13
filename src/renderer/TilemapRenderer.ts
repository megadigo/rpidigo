/**
 * TilemapRenderer — central tile registry and renderer.
 *
 * TILE_DEFS is the single source of truth for every tile type:
 *   - sprite   : spritesheet key (frame 0, 16×16 — global sprite convention)
 *   - layer    : GROUND | MIDDLE | TOP
 *   - impassable: blocks player movement
 *   - speedMod : < 1 = slower (passable tiles only)
 *
 * Render layers:
 *   GROUND (depth 0)  — terrain: grass, water, stone floors
 *   MIDDLE (depth 1)  — objects on the ground: trees, rocks, furniture
 *   TOP    (depth 20) — covers the player (depth 10) when inside buildings
 *
 * Every rendered position is guaranteed to have a GROUND tile; when the
 * stored tile type is MIDDLE or TOP the renderer auto-places the fallback
 * GROUND sprite underneath.
 *
 * Consumers:
 *   LoadingScene  → getTileSheets()    to know which spritesheets to preload
 *   CollisionMap  → isTileImpassable() / getTileSpeedMod()
 */
import Phaser from 'phaser'
import { getTile } from '../world/ChunkManager.ts'

export const TILE_SIZE = 16

export type TileLayer = 'GROUND' | 'MIDDLE' | 'TOP'

interface TileDef {
  sprite:      string
  layer:       TileLayer
  impassable?: true
  speedMod?:   number   // < 1 = slower; only meaningful when not impassable
}

const FALLBACK_SPRITE = 'Ground/Grass'

/** Depth assigned to each layer in the Phaser scene. Player is at depth 10. */
const LAYER_DEPTH: Record<TileLayer, number> = {
  GROUND: 0,
  MIDDLE: 1,
  TOP:    20,
}

/**
 * Central tile definition registry.
 * Add new tile types here — no other file needs to change.
 */
export const TILE_DEFS: Record<string, TileDef> = {
  // ── Plains ────────────────────────────────────────────────────────────────
  grass:               { sprite: 'Ground/Grass',             layer: 'GROUND' },
  grass_tall:          { sprite: 'Ground/GrassTall',         layer: 'GROUND', speedMod: 0.6 },
  flower_yellow:       { sprite: 'Ground/GrassFlowerYellow', layer: 'GROUND' },
  flower_red:          { sprite: 'Ground/GrassFlowerRed',    layer: 'GROUND' },
  dirt_path:           { sprite: 'Ground/DeadGrass',         layer: 'GROUND' },
  rock_small:          { sprite: 'Nature/RockSmall',         layer: 'MIDDLE', impassable: true },
  rock_large:          { sprite: 'Nature/RocksBig',          layer: 'MIDDLE', impassable: true },
  // ── Forest ────────────────────────────────────────────────────────────────
  grass_dark:          { sprite: 'Ground/GrassTall',         layer: 'GROUND' },
  tree_oak:            { sprite: 'Nature/Trees',             layer: 'MIDDLE', impassable: true },
  tree_pine:           { sprite: 'Nature/PineTrees',         layer: 'MIDDLE', impassable: true },
  tree_dead:           { sprite: 'Nature/DeadTrees',         layer: 'MIDDLE', impassable: true },
  bush:                { sprite: 'Nature/Trees',             layer: 'MIDDLE', impassable: true },
  mushroom:            { sprite: 'Ground/GrassTall',         layer: 'MIDDLE' },
  log:                 { sprite: 'Nature/DeadTrees',         layer: 'MIDDLE' },
  moss_rock:           { sprite: 'Nature/RocksBig',          layer: 'MIDDLE', impassable: true },
  stump:               { sprite: 'Nature/DeadTrees',         layer: 'MIDDLE' },
  // ── River ─────────────────────────────────────────────────────────────────
  water_shallow:       { sprite: 'Ground/Shore',             layer: 'GROUND', impassable: true },
  water_deep:          { sprite: 'Ground/Cliff-Water',       layer: 'MIDDLE', impassable: true },
  sand_bank:           { sprite: 'Ground/Shore',             layer: 'GROUND' },
  reeds:               { sprite: 'Ground/Shore',             layer: 'GROUND', speedMod: 0.7 },
  bridge:              { sprite: 'Miscellaneous/Bridge',     layer: 'GROUND' },
  mud:                 { sprite: 'Ground/DeadGrass',         layer: 'GROUND', speedMod: 0.5 },
  // ── Desert ────────────────────────────────────────────────────────────────
  sand:                { sprite: 'Ground/DeadGrass',         layer: 'GROUND' },
  sand_dune:           { sprite: 'Ground/DeadGrass',         layer: 'GROUND', speedMod: 0.7 },
  dry_rock:            { sprite: 'Nature/RockSmall',         layer: 'MIDDLE', impassable: true },
  cactus:              { sprite: 'Nature/Cactus',            layer: 'MIDDLE', impassable: true },
  dry_grass:           { sprite: 'Nature/Tumbleweed',        layer: 'MIDDLE' },
  oasis_water:         { sprite: 'Ground/Shore',             layer: 'GROUND', impassable: true },
  quicksand:           { sprite: 'Ground/DeadGrass',         layer: 'GROUND', speedMod: 0.4 },
  // ── Village ───────────────────────────────────────────────────────────────
  cobblestone:         { sprite: 'Ground/DeadGrass',         layer: 'GROUND' },
  house_floor:         { sprite: 'Ground/Grass',             layer: 'GROUND' },
  house_wall:          { sprite: 'Buildings/Wood/Houses',    layer: 'MIDDLE', impassable: true },
  house_door:          { sprite: 'Buildings/Wood/Houses',    layer: 'MIDDLE' },
  house_roof:          { sprite: 'Buildings/Wood/Houses',    layer: 'TOP' },
  well:                { sprite: 'Miscellaneous/Well',       layer: 'MIDDLE', impassable: true },
  fence:               { sprite: 'Buildings/Wood/Houses',    layer: 'MIDDLE', impassable: true },
  market_stall:        { sprite: 'Buildings/Wood/Market',    layer: 'MIDDLE', impassable: true },
  blacksmith_forge:    { sprite: 'Buildings/Wood/Workshops', layer: 'MIDDLE', impassable: true },
  tavern_sign:         { sprite: 'Buildings/Wood/Taverns',   layer: 'MIDDLE' },
  lantern:             { sprite: 'Miscellaneous/Signs',      layer: 'MIDDLE' },
  garden_plot:         { sprite: 'Ground/Grass',             layer: 'GROUND' },
  // ── Dungeon ───────────────────────────────────────────────────────────────
  dungeon_entrance:    { sprite: 'Ground/Cliff',             layer: 'GROUND' },
  dungeon_floor:       { sprite: 'Ground/Cliff',             layer: 'GROUND' },
  dungeon_wall:        { sprite: 'Ground/Cliff',             layer: 'MIDDLE', impassable: true },
  dungeon_door:        { sprite: 'Buildings/Wood/Houses',    layer: 'MIDDLE' },
  dungeon_stairs_down: { sprite: 'Ground/Cliff',             layer: 'GROUND' },
  dungeon_stairs_up:   { sprite: 'Ground/Cliff',             layer: 'GROUND' },
  dungeon_torch:       { sprite: 'Miscellaneous/Signs',      layer: 'MIDDLE' },
  dungeon_pillar:      { sprite: 'Ground/Cliff',             layer: 'MIDDLE', impassable: true },
  dungeon_trap:        { sprite: 'Ground/Cliff',             layer: 'GROUND' },
  dungeon_chest:       { sprite: 'Miscellaneous/Chests',     layer: 'MIDDLE' },
  dungeon_altar:       { sprite: 'Ground/Cliff',             layer: 'MIDDLE', impassable: true },
  // ── Special ───────────────────────────────────────────────────────────────
  house:               { sprite: 'Buildings/Wood/Huts',      layer: 'TOP',    impassable: true },
  workbench:           { sprite: 'Buildings/Wood/Workshops', layer: 'MIDDLE', impassable: true },
  chest:               { sprite: 'Miscellaneous/Chests',     layer: 'MIDDLE' },
  void:                { sprite: 'Ground/Cliff',             layer: 'MIDDLE', impassable: true },
}

// ── Public helpers (consumed by LoadingScene and CollisionMap) ─────────────

/**
 * Returns the unique set of spritesheet keys needed by all tile definitions.
 * LoadingScene calls this instead of maintaining its own list.
 */
export function getTileSheets(): string[] {
  return [...new Set(Object.values(TILE_DEFS).map(d => d.sprite))]
}

/** Returns true if the tile type blocks movement. */
export function isTileImpassable(type: string): boolean {
  return TILE_DEFS[type]?.impassable === true
}

/** Returns the movement speed multiplier for a tile type (1.0 = normal). */
export function getTileSpeedMod(type: string): number {
  return TILE_DEFS[type]?.speedMod ?? 1.0
}

// ── Renderer ──────────────────────────────────────────────────────────────

export class TilemapRenderer {
  private scene: Phaser.Scene

  /** Placed ground images, keyed by `${tx}_${ty}`. */
  private placedGround = new Map<string, Phaser.GameObjects.Image>()
  /** Placed middle images per position (0 or more), keyed by `${tx}_${ty}`. */
  private placedMiddle = new Map<string, Phaser.GameObjects.Image[]>()
  /** Placed top images, keyed by `${tx}_${ty}`. */
  private placedTop    = new Map<string, Phaser.GameObjects.Image>()

  /** Shared object pool for recycled Image objects. */
  private pool: Phaser.GameObjects.Image[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  private acquire(spriteKey: string, layer: TileLayer, tx: number, ty: number): Phaser.GameObjects.Image {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, spriteKey)
    img.setTexture(spriteKey, 0)
    img.setOrigin(0, 0)
    img.setPosition(tx * TILE_SIZE, ty * TILE_SIZE)
    img.setDepth(LAYER_DEPTH[layer])
    img.setVisible(true)
    return img
  }

  private release(img: Phaser.GameObjects.Image): void {
    img.setVisible(false)
    this.pool.push(img)
  }

  /**
   * Draw all tiles visible in the given world-coordinate viewport.
   * Each position is processed once: GROUND first, then all MIDDLEs, then TOP.
   * Positions whose GROUND is already placed are skipped entirely.
   */
  drawViewport(
    worldLeft: number,
    worldTop: number,
    worldRight: number,
    worldBottom: number,
  ): void {
    const startX = Math.floor(worldLeft  / TILE_SIZE)
    const startY = Math.floor(worldTop   / TILE_SIZE)
    const endX   = Math.ceil(worldRight  / TILE_SIZE)
    const endY   = Math.ceil(worldBottom / TILE_SIZE)

    for (let tx = startX; tx <= endX; tx++) {
      for (let ty = startY; ty <= endY; ty++) {
        const k = `${tx}_${ty}`
        if (this.placedGround.has(k)) continue  // position already fully rendered

        const tile = getTile(tx, ty)
        if (!tile) continue   // chunk not yet loaded

        // GROUND (always required)
        const groundSprite = TILE_DEFS[tile.g]?.sprite ?? FALLBACK_SPRITE
        this.placedGround.set(k, this.acquire(groundSprite, 'GROUND', tx, ty))

        // MIDDLE (zero or more)
        if (tile.m?.length) {
          const imgs: Phaser.GameObjects.Image[] = []
          for (const mType of tile.m) {
            imgs.push(this.acquire(TILE_DEFS[mType]?.sprite ?? FALLBACK_SPRITE, 'MIDDLE', tx, ty))
          }
          this.placedMiddle.set(k, imgs)
        }

        // TOP (zero or one)
        if (tile.t) {
          const topSprite = TILE_DEFS[tile.t]?.sprite ?? FALLBACK_SPRITE
          this.placedTop.set(k, this.acquire(topSprite, 'TOP', tx, ty))
        }
      }
    }
  }

  /** Force redraw of a single tile on all layers (e.g. after modification). */
  invalidateTile(tx: number, ty: number): void {
    const k = `${tx}_${ty}`
    const g = this.placedGround.get(k)
    if (g) { this.release(g); this.placedGround.delete(k) }
    const ms = this.placedMiddle.get(k)
    if (ms) { for (const m of ms) this.release(m); this.placedMiddle.delete(k) }
    const t = this.placedTop.get(k)
    if (t) { this.release(t); this.placedTop.delete(k) }
  }

  /** Tear down all rendered tiles and reset the pool. */
  reset(): void {
    for (const img of this.placedGround.values()) img.destroy()
    for (const imgs of this.placedMiddle.values()) for (const img of imgs) img.destroy()
    for (const img of this.placedTop.values()) img.destroy()
    for (const img of this.pool) img.destroy()
    this.placedGround.clear()
    this.placedMiddle.clear()
    this.placedTop.clear()
    this.pool.length = 0
  }
}

