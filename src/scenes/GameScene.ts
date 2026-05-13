/**
 * GameScene — main gameplay: tilemap, player sprite, camera.
 */
import Phaser from 'phaser'
import { TilemapRenderer, TILE_SIZE } from '../renderer/TilemapRenderer.ts'
import { PlayerController } from '../player/PlayerController.ts'

export class GameScene extends Phaser.Scene {
  private tilemapRenderer!: TilemapRenderer
  private playerController!: PlayerController

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    this.tilemapRenderer = new TilemapRenderer(this)
    this.playerController = new PlayerController(this)
    this.playerController.create()

    // Launch HUD as additive scene
    this.scene.launch('HudScene')

    // Zoom controls (scroll wheel)
    this.input.on('wheel', (_p: unknown, _go: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main
      const step = dy > 0 ? -1 : 1
      const newZoom = Phaser.Math.Clamp(cam.zoom + step, 1, 4)
      cam.setZoom(newZoom)
      localStorage.setItem('rpidigo.zoom', String(newZoom))
    })

    const savedZoom = parseInt(localStorage.getItem('rpidigo.zoom') ?? '1', 10)
    // Clamp: if a stale zoom=2 was saved, allow it; scroll wheel can still increase
    this.cameras.main.setZoom(Phaser.Math.Clamp(savedZoom, 1, 3))
  }

  update(_time: number, delta: number): void {
    this.playerController.update(delta)

    // Use the camera's actual world viewport so tiles render exactly what is visible
    const cam = this.cameras.main
    const v = cam.worldView
    this.tilemapRenderer.drawViewport(
      v.left  - TILE_SIZE,
      v.top   - TILE_SIZE,
      v.right + TILE_SIZE,
      v.bottom + TILE_SIZE,
    )
  }
}
