/**
 * TilemapRenderer — renders world tiles using Phaser Image objects.
 *
 * Each tile type maps to a spritesheet key; frame 0 (top-left 16×16 px) is used
 * for every tile until animation is added (global sprite convention).
 *
 * Tiles are placed once as they enter the viewport and stay in-world.
 * `invalidateTile` removes and re-creates a single tile (after modification).
 * `reset` tears down everything (scene restart / room transition).
 */
import Phaser from 'phaser'
import { getTile } from '../world/ChunkManager.ts'

export const TILE_SIZE = 16

/** Maps tile type → spritesheet key (loaded in LoadingScene.preload). */
const TILE_SPRITE: Record<string, string> = {
  // Plains
  grass:              'Ground/Grass',
  grass_tall:         'Ground/TexturedGrass',
  flower_yellow:      'Ground/Grass',
  flower_red:         'Ground/Grass',
  dirt_path:          'Ground/DeadGrass',
  rock_small:         'Nature/Rocks',
  rock_large:         'Nature/Rocks',
  // Forest
  grass_dark:         'Ground/TexturedGrass',
  tree_oak:           'Nature/Trees',
  tree_pine:          'Nature/PineTrees',
  tree_dead:          'Nature/DeadTrees',
  bush:               'Nature/Trees',
  mushroom:           'Ground/TexturedGrass',
  log:                'Nature/DeadTrees',
  moss_rock:          'Nature/Rocks',
  stump:              'Nature/DeadTrees',
  // River
  water_shallow:      'Ground/Shore',
  water_deep:         'Ground/Cliff-Water',
  sand_bank:          'Ground/Shore',
  reeds:              'Ground/Shore',
  bridge:             'Miscellaneous/Bridge',
  mud:                'Ground/DeadGrass',
  // Desert
  sand:               'Ground/DeadGrass',
  sand_dune:          'Ground/DeadGrass',
  dry_rock:           'Nature/Rocks',
  cactus:             'Nature/Cactus',
  dry_grass:          'Nature/Tumbleweed',
  oasis_water:        'Ground/Shore',
  quicksand:          'Ground/DeadGrass',
  // Village
  cobblestone:        'Ground/DeadGrass',
  house_floor:        'Ground/Grass',
  house_wall:         'Buildings/Wood/Houses',
  house_door:         'Buildings/Wood/Houses',
  house_roof:         'Buildings/Wood/Houses',
  well:               'Miscellaneous/Well',
  fence:              'Buildings/Wood/Houses',
  market_stall:       'Buildings/Wood/Market',
  blacksmith_forge:   'Buildings/Wood/Workshops',
  tavern_sign:        'Buildings/Wood/Taverns',
  lantern:            'Miscellaneous/Signs',
  garden_plot:        'Ground/Grass',
  // Dungeon
  dungeon_entrance:   'Ground/Cliff',
  dungeon_floor:      'Ground/Cliff',
  dungeon_wall:       'Ground/Cliff',
  dungeon_door:       'Buildings/Wood/Houses',
  dungeon_stairs_down: 'Ground/Cliff',
  dungeon_stairs_up:   'Ground/Cliff',
  dungeon_torch:      'Miscellaneous/Signs',
  dungeon_pillar:     'Ground/Cliff',
  dungeon_trap:       'Ground/Cliff',
  dungeon_chest:      'Miscellaneous/Chests',
  dungeon_altar:      'Ground/Cliff',
  // Special
  house:              'Buildings/Wood/Huts',
  workbench:          'Buildings/Wood/Workshops',
  chest:              'Miscellaneous/Chests',
  void:               'Ground/Cliff',
}

const FALLBACK_SPRITE = 'Ground/Grass'

export class TilemapRenderer {
  private scene: Phaser.Scene
  /** Placed tile images — key `${tx}_${ty}`. */
  private placed = new Map<string, Phaser.GameObjects.Image>()
  /** Object pool for recycled images. */
  private pool: Phaser.GameObjects.Image[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  private acquire(spriteKey: string, tx: number, ty: number): Phaser.GameObjects.Image {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, spriteKey)
    img.setTexture(spriteKey, 0)
    img.setOrigin(0, 0)
    img.setPosition(tx * TILE_SIZE, ty * TILE_SIZE)
    img.setDepth(0)
    img.setVisible(true)
    return img
  }

  private release(img: Phaser.GameObjects.Image): void {
    img.setVisible(false)
    this.pool.push(img)
  }

  /**
   * Draw all tiles visible in the given world-coordinate viewport.
   * Only places tiles that haven't been placed yet.
   */
  drawViewport(
    worldLeft: number,
    worldTop: number,
    worldRight: number,
    worldBottom: number,
  ): void {
    const startX = Math.floor(worldLeft / TILE_SIZE)
    const startY = Math.floor(worldTop / TILE_SIZE)
    const endX   = Math.ceil(worldRight / TILE_SIZE)
    const endY   = Math.ceil(worldBottom / TILE_SIZE)

    for (let tx = startX; tx <= endX; tx++) {
      for (let ty = startY; ty <= endY; ty++) {
        const k = `${tx}_${ty}`
        if (this.placed.has(k)) continue

        const tile = getTile(tx, ty)
        if (!tile) continue   // chunk not yet loaded

        const spriteKey = TILE_SPRITE[tile.type] ?? FALLBACK_SPRITE
        const img = this.acquire(spriteKey, tx, ty)
        this.placed.set(k, img)
      }
    }
  }

  /** Force redraw of a single tile (after modification). */
  invalidateTile(tx: number, ty: number): void {
    const k = `${tx}_${ty}`
    const img = this.placed.get(k)
    if (img) {
      this.release(img)
      this.placed.delete(k)
    }
  }

  /** Clear everything and reset. */
  reset(): void {
    for (const img of this.placed.values()) img.destroy()
    for (const img of this.pool) img.destroy()
    this.placed.clear()
    this.pool.length = 0
  }
}
