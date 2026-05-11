/**
 * TilemapRenderer — renders world tiles using Phaser Graphics primitives.
 *
 * Phase 3 uses a simple coloured-rectangle renderer (no tileset sprites yet) so the
 * game is playable immediately.  Each tile type maps to an ARGB colour constant.
 * A later phase will swap this for a real spritesheet-based tilemap.
 */
import Phaser from 'phaser'
import { getTile } from '../world/ChunkManager.ts'

export const TILE_SIZE = 16

/** Colour table — hex 0xRRGGBB. */
const TILE_COLORS: Record<string, number> = {
  // Plains
  grass:          0x3a8a3a,
  grass_tall:     0x2e7a2e,
  flower_yellow:  0xd4c840,
  flower_red:     0xc04040,
  dirt_path:      0xa07850,
  rock_small:     0x808080,
  rock_large:     0x606060,
  // Forest
  grass_dark:     0x1e5c1e,
  tree_oak:       0x1a5c1a,
  tree_pine:      0x1a4c2a,
  tree_dead:      0x4a3a2a,
  bush:           0x2a6030,
  mushroom:       0xd4603a,
  log:            0x6a4a2a,
  moss_rock:      0x506040,
  stump:          0x6a5030,
  // River
  water_shallow:  0x3a7ab8,
  water_deep:     0x1a4a88,
  sand_bank:      0xd4b878,
  reeds:          0x6a8a4a,
  bridge:         0x8a6a3a,
  mud:            0x6a5040,
  // Desert
  sand:           0xe0c87a,
  sand_dune:      0xcab060,
  dry_rock:       0x987060,
  cactus:         0x4a8040,
  dry_grass:      0xb0a050,
  oasis_water:    0x3a8ab0,
  quicksand:      0xc8a860,
  // Village
  cobblestone:    0x9a9090,
  house_floor:    0xc8a878,
  house_wall:     0x805040,
  house_door:     0x60381a,
  house_roof:     0x803030,
  well:           0x708090,
  fence:          0xa07850,
  market_stall:   0xd09030,
  blacksmith_forge: 0x504040,
  tavern_sign:    0xa06820,
  lantern:        0xffd060,
  garden_plot:    0x5a8030,
  // Dungeon entrance
  dungeon_entrance: 0x303030,
  dungeon_floor:  0x484848,
  dungeon_wall:   0x282828,
  dungeon_door:   0x5a4a38,
  dungeon_stairs_down: 0x3a70a0,
  dungeon_stairs_up:   0x70a03a,
  dungeon_torch:  0xffa030,
  dungeon_pillar: 0x404040,
  dungeon_trap:   0x803020,
  dungeon_chest:  0xa08020,
  dungeon_altar:  0x806080,
  // Special
  house:          0xc07030,
  workbench:      0xa06030,
  chest:          0xa08020,
  void:           0x000000,
}

const DEFAULT_COLOR = 0x888888

export class TilemapRenderer {
  private gfx: Phaser.GameObjects.Graphics
  private drawnTiles = new Set<string>()

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(0)
  }

  /**
   * Draw all tiles visible in the given world-coordinate viewport.
   * Only redraws tiles that have changed (tracks drawn set).
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
        const key = `${tx}_${ty}`
        if (this.drawnTiles.has(key)) continue

        const tile = getTile(tx, ty)
        if (!tile) continue    // not loaded yet

        const color = TILE_COLORS[tile.type] ?? DEFAULT_COLOR
        this.gfx.fillStyle(color, 1)
        this.gfx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        this.drawnTiles.add(key)
      }
    }
  }

  /** Force redraw of a single tile (after modification). */
  invalidateTile(tx: number, ty: number): void {
    this.drawnTiles.delete(`${tx}_${ty}`)
  }

  /** Clear everything and reset. */
  reset(): void {
    this.gfx.clear()
    this.drawnTiles.clear()
  }
}
