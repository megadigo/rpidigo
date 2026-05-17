/**
 * TilemapRenderer — central tile registry and renderer.
 *
 * TILE_DEFS is the single source of truth for every tile type:
 *   - sprite   : spritesheet key (frame 0, 16×16 — global sprite convention)
 *   - layer    : GROUND | MIDDLE | TOP
 *   - impassable: blocks player movement
 *   - speedMod : < 1 = slower (passable tiles only)
 *   - entry    : 'house' | 'dungeon' — tile triggers a room transition on interact
 *   - roomExit : true — tile returns the player to the overworld on interact
 *
 * Render layers:
 *   GROUND (depth 0)  — terrain: grass, water, stone floors
 *   MIDDLE (depth 1)  — objects on the ground: trees, rocks, furniture
 *   TOP    (depth 20) — covers the player (depth 10)
 *
 * Every rendered position is guaranteed to have a GROUND tile.
 *
 * Consumers:
 *   LoadingScene  → getTileSheets()    to know which spritesheets to preload
 *   CollisionMap  → isTileImpassable() / getTileSpeedMod()
 *   PlayerController → getTileEntryType() / isTileRoomExit()
 */
import Phaser from 'phaser'
import { getTile } from '../world/ChunkManager.ts'

export const TILE_SIZE = 16

export type TileLayer = 'GROUND' | 'MIDDLE' | 'TOP'

interface TileDef {
  sprite:      string
  layer:       TileLayer
  impassable?: true
  speedMod?:   number        // < 1 = slower; only meaningful when not impassable
  entry?:      'house' | 'dungeon'  // adjacent interact triggers room entry
  roomExit?:   true          // stepping on this returns player to overworld
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
 *
 * Sprites removed from old system:
 *   Bridge, Door, Wall, Roof, Forge, Lantern — replaced by actual available sprites.
 * Cliff-Water / Cliff — no longer used; dungeon tiles use Buildings/Dungeon.
 */
export const TILE_DEFS: Record<string, TileDef> = {
  // ── Plains ────────────────────────────────────────────────────────────────
  grass:               { sprite: 'Ground/Grass',              layer: 'GROUND' },
  grass_tall:          { sprite: 'Ground/GrassTall',          layer: 'GROUND', speedMod: 0.6 },
  flower_yellow:       { sprite: 'Ground/GrassFlowerYellow',  layer: 'GROUND' },
  flower_red:          { sprite: 'Ground/GrassFlowerRed',     layer: 'GROUND' },
  dirt_path:           { sprite: 'Ground/PathDirt',           layer: 'GROUND', speedMod: 1.1},
  rock_small:          { sprite: 'Nature/RockSmall',          layer: 'MIDDLE', impassable: true },
  rock_large:          { sprite: 'Nature/RocksBig',           layer: 'MIDDLE', impassable: true },
  // ── Forest ────────────────────────────────────────────────────────────────
  grass_dark:          { sprite: 'Ground/GrassTall',          layer: 'GROUND' },
  tree_oak:            { sprite: 'Nature/Trees',              layer: 'MIDDLE', impassable: true },
  tree_pine:           { sprite: 'Nature/PineTrees',          layer: 'MIDDLE', impassable: true },
  coconut_tree:        { sprite: 'Nature/CoconutTrees',       layer: 'MIDDLE', impassable: true },
  bush:                { sprite: 'Nature/Trees',              layer: 'MIDDLE', impassable: true },
  mushroom:            { sprite: 'Ground/GrassTall',          layer: 'GROUND' },
  log:                 { sprite: 'Nature/Stump',              layer: 'MIDDLE' },
  moss_rock:           { sprite: 'Nature/RockMoss',           layer: 'MIDDLE', impassable: true },
  stump:               { sprite: 'Nature/Stump',              layer: 'MIDDLE' },
  // ── River ─────────────────────────────────────────────────────────────────
  water_shallow:       { sprite: 'Ground/WaterShallow',       layer: 'GROUND', speedMod: 0.1  },
  water_deep:          { sprite: 'Ground/WaterDeep',          layer: 'GROUND', speedMod: 0.2  },
  sand_bank:           { sprite: 'Ground/Sand',               layer: 'GROUND' },
  reeds:               { sprite: 'Ground/GrassTall',          layer: 'GROUND', speedMod: 0.7 },
  mud:                 { sprite: 'Ground/Mud',                layer: 'GROUND', speedMod: 0.5 },
  // ── Desert ────────────────────────────────────────────────────────────────
  sand:                { sprite: 'Ground/Sand',               layer: 'GROUND' },
  sand_dune:           { sprite: 'Ground/SandDune',           layer: 'GROUND', speedMod: 0.7 },
  dry_rock:            { sprite: 'Nature/RockSmall',          layer: 'MIDDLE', impassable: true },
  cactus:              { sprite: 'Nature/Cactus',             layer: 'MIDDLE', impassable: true },
  dry_grass:           { sprite: 'Nature/Tumbleweed',         layer: 'MIDDLE' },
  oasis_water:         { sprite: 'Ground/WaterOasis',         layer: 'GROUND', speedMod: 0.2 } ,
  quicksand:           { sprite: 'Ground/GrassDead',          layer: 'GROUND', speedMod: 0.4 },
  // ── Village — single-sprite buildings replace old wall/roof/door system ──
  cobblestone:         { sprite: 'Ground/GrassDead',          layer: 'GROUND' },
  house_hut:           { sprite: 'Buildings/Huts',            layer: 'MIDDLE', impassable: true, entry: 'house' },
  house_cabin:         { sprite: 'Buildings/Houses',          layer: 'MIDDLE', impassable: true, entry: 'house' },
  barracks:            { sprite: 'Buildings/Barracks',        layer: 'MIDDLE', impassable: true, entry: 'house' },
  chapel:              { sprite: 'Buildings/Chapels',         layer: 'MIDDLE', impassable: true, entry: 'house' },
  tavern:              { sprite: 'Buildings/Taverns',         layer: 'MIDDLE', impassable: true, entry: 'house' },
  well:                { sprite: 'Miscellaneous/Well',        layer: 'MIDDLE', impassable: true },
  market_stall:        { sprite: 'Buildings/Market',          layer: 'MIDDLE', impassable: true },
  workshop:            { sprite: 'Buildings/Workshops',       layer: 'MIDDLE', impassable: true, entry: 'house' },
  quest_board:         { sprite: 'Miscellaneous/QuestBoard',  layer: 'MIDDLE' },
  street_sign:         { sprite: 'Miscellaneous/StreetSign',  layer: 'MIDDLE' },
  tombstone:           { sprite: 'Miscellaneous/Tombstones',  layer: 'MIDDLE', impassable: true },
  garden_plot:         { sprite: 'Ground/Grass',              layer: 'GROUND' },
  wheat_field:         { sprite: 'Nature/Wheatfield',         layer: 'MIDDLE', speedMod: 0.8 },
  // ── Dungeon — all use Buildings/Dungeon; no Cliff/Door/Torch/Forge ───────
  dungeon_entrance:    { sprite: 'Buildings/DungeonEntrance', layer: 'GROUND', entry: 'dungeon' },
  dungeon_floor:       { sprite: 'Ground/DungeonFloor',       layer: 'GROUND' },
  dungeon_wall:        { sprite: 'Buildings/DungeonWall',     layer: 'MIDDLE', impassable: true },
  dungeon_stairs_down: { sprite: 'Ground/StairDown',          layer: 'GROUND' },
  dungeon_stairs_up:   { sprite: 'Ground/StairUp',            layer: 'MIDDLE', roomExit: true },
  dungeon_pillar:      { sprite: 'Buildings/DungeonPillar',   layer: 'MIDDLE' },
  dungeon_trap:        { sprite: 'Miscellaneous/Tombstones', layer: 'GROUND' },
  dungeon_chest:       { sprite: 'Miscellaneous/Chests',      layer: 'MIDDLE' },
  dungeon_altar:       { sprite: 'Miscellaneous/DungeonAltar',layer: 'MIDDLE', impassable: true },
  dungeon_tombstones:  { sprite: 'Miscellaneous/Tombstones',  layer: 'MIDDLE', impassable: true },
  // ── Special / Interior ────────────────────────────────────────────────────
  house_floor:         { sprite: 'Ground/HouseFloor',         layer: 'GROUND' },
  house_exit:         { sprite:  'Buildings/Door',         layer: 'MIDDLE', roomExit: true },
  workbench:           { sprite: 'Miscellaneous/WorkBench',   layer: 'MIDDLE', impassable: true },
  table:               { sprite: 'Miscellaneous/Table',       layer: 'MIDDLE', impassable: true },
  bed:                 { sprite: 'Miscellaneous/Bed',         layer: 'MIDDLE', impassable: true },
  sofa:                { sprite: 'Miscellaneous/Sofa',        layer: 'MIDDLE', impassable: true },
  chest:               { sprite: 'Miscellaneous/Chests',      layer: 'MIDDLE' },
  void:                { sprite: 'Ground/GrassDead',          layer: 'MIDDLE', impassable: true },
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

/**
 * Returns the entry type if adjacent-interact on this tile should open a room,
 * or null if the tile has no entry behaviour.
 */
export function getTileEntryType(type: string): 'house' | 'dungeon' | null {
  return TILE_DEFS[type]?.entry ?? null
}

/** Returns true if stepping on this tile should return the player to the overworld. */
export function isTileRoomExit(type: string): boolean {
  return TILE_DEFS[type]?.roomExit === true
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

    // Cull tiles that have scrolled out of the viewport
    for (const k of this.placedGround.keys()) {
      const us = k.indexOf('_')
      const tx = +k.slice(0, us)
      const ty = +k.slice(us + 1)
      if (tx < startX || tx > endX || ty < startY || ty > endY) {
        this.release(this.placedGround.get(k)!)
        this.placedGround.delete(k)
        const ms = this.placedMiddle.get(k)
        if (ms) { for (const m of ms) this.release(m); this.placedMiddle.delete(k) }
        const t = this.placedTop.get(k)
        if (t) { this.release(t); this.placedTop.delete(k) }
      }
    }

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

