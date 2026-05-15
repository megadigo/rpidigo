/**
 * GameScene — main gameplay: tilemap, player sprite, camera.
 *
 * Listens for 'enterRoom' and 'exitRoom' events from PlayerController to handle
 * transitions between the overworld and house/dungeon interior rooms.
 */
import Phaser from 'phaser'
import { TilemapRenderer, TILE_SIZE } from '../renderer/TilemapRenderer.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { enterRoom, exitRoom } from '../world/ChunkManager.ts'
import { HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'

/** Tile bounds of the 1000×1000 overworld in pixels. */
const WORLD_PIXEL_SIZE = 1000 * TILE_SIZE

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
    this.cameras.main.setZoom(Phaser.Math.Clamp(savedZoom, 1, 3))

    // Room transition events emitted by PlayerController
    this.events.on(
      'enterRoom',
      (data: { roomId: string; spawnX: number; spawnY: number }) => {
        void this._handleEnterRoom(data.roomId, data.spawnX, data.spawnY)
      },
    )

    this.events.on(
      'exitRoom',
      (data: { returnX: number; returnY: number }) => {
        this._handleExitRoom(data.returnX, data.returnY)
      },
    )
  }

  update(_time: number, delta: number): void {
    this.playerController.update(delta)

    const cam = this.cameras.main
    const v = cam.worldView
    this.tilemapRenderer.drawViewport(
      v.left  - TILE_SIZE,
      v.top   - TILE_SIZE,
      v.right + TILE_SIZE,
      v.bottom + TILE_SIZE,
    )
  }

  private async _handleEnterRoom(roomId: string, spawnX: number, spawnY: number): Promise<void> {
    // Persist room in player record so HUD/presence stays consistent
    const player = getLocalPlayer()
    player.room = roomId
    setLocalPlayer(player)

    await enterRoom(roomId)
    this.tilemapRenderer.reset()
    this.playerController.teleport(spawnX, spawnY)

    // Narrow camera bounds to the room size
    const roomSize = roomId.startsWith('house_') ? HOUSE_ROOM_SIZE : 40
    this.cameras.main.setBounds(0, 0, roomSize * TILE_SIZE, roomSize * TILE_SIZE)
  }

  private _handleExitRoom(returnX: number, returnY: number): void {
    exitRoom()

    const player = getLocalPlayer()
    player.room = '0'
    setLocalPlayer(player)

    this.tilemapRenderer.reset()
    this.playerController.teleport(returnX, returnY)

    // Restore overworld camera bounds
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_SIZE, WORLD_PIXEL_SIZE)
  }
}
