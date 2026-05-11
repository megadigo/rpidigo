/**
 * PlayerController — keyboard input, client-predicted movement, Firebase sync.
 */
import Phaser from 'phaser'
import { db } from '../firebase.ts'
import { ref, update } from 'firebase/database'
import { getLocalPlayer, setLocalPlayer } from './Auth.ts'
import { isPassable, getSpeedMod } from '../world/CollisionMap.ts'
import { ensureRadius, tileToChunk } from '../world/ChunkManager.ts'
import { TILE_SIZE } from '../renderer/TilemapRenderer.ts'

/** Pixels per second at base speed. */
const BASE_SPEED = 80
/** Time in ms between Firebase position writes. */
const SYNC_INTERVAL = 100

export class PlayerController {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key }
  private sprite!: Phaser.GameObjects.Rectangle
  private lastSync = 0
  private lastChunk = ''

  /** World-pixel position (not tile). */
  px = 0
  py = 0

  private scene: Phaser.Scene
  constructor(scene: Phaser.Scene) { this.scene = scene }

  create(): void {
    const player = getLocalPlayer()
    this.px = player.x * TILE_SIZE + TILE_SIZE / 2
    this.py = player.y * TILE_SIZE + TILE_SIZE / 2

    // Player sprite — coloured rectangle until spritesheet phase
    this.sprite = this.scene.add.rectangle(this.px, this.py, 12, 14, 0xffffff)
    this.sprite.setDepth(10)

    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys()
      this.wasd = {
        up:    this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down:  this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left:  this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      }
    }

    // Follow camera
    this.scene.cameras.main.startFollow(this.sprite, true, 0.1, 0.1)
    this.scene.cameras.main.setBounds(0, 0, 1000 * TILE_SIZE, 1000 * TILE_SIZE)
    this.scene.cameras.main.setZoom(2)
  }

  update(delta: number): void {
    if (!this.cursors) return

    const up    = this.cursors.up.isDown    || this.wasd.up.isDown
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown
    const right = this.cursors.right.isDown || this.wasd.right.isDown

    let vx = 0
    let vy = 0
    if (left)  vx -= 1
    if (right) vx += 1
    if (up)    vy -= 1
    if (down)  vy += 1

    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707 }

    if (vx !== 0 || vy !== 0) {
      const tx = Math.floor(this.px / TILE_SIZE)
      const ty = Math.floor(this.py / TILE_SIZE)
      const speedMod = getSpeedMod(tx, ty)
      const speed = BASE_SPEED * speedMod * (delta / 1000)

      const nx = this.px + vx * speed
      const ny = this.py + vy * speed

      const ntx = Math.floor(nx / TILE_SIZE)
      const nty = Math.floor(ny / TILE_SIZE)

      if (isPassable(ntx, ty))  this.px = nx
      if (isPassable(tx, nty))  this.py = ny

      this.sprite.setPosition(this.px, this.py)

      // Lazy-load chunks as player moves
      const ck = tileToChunk(Math.floor(this.px / TILE_SIZE), Math.floor(this.py / TILE_SIZE))
      if (ck !== this.lastChunk) {
        this.lastChunk = ck
        const [cxStr, cyStr] = ck.split('_')
        void ensureRadius(parseInt(cxStr), parseInt(cyStr), 2)
      }
    }

    // Sync to Firebase at throttled interval
    this.lastSync += delta
    if (this.lastSync >= SYNC_INTERVAL) {
      this.lastSync = 0
      this._syncPosition()
    }
  }

  private _syncPosition(): void {
    const player = getLocalPlayer()
    const tx = Math.floor(this.px / TILE_SIZE)
    const ty = Math.floor(this.py / TILE_SIZE)
    if (tx === player.x && ty === player.y) return

    player.x = tx
    player.y = ty
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/x`]: tx,
      [`players/${player.id}/y`]: ty,
      [`presence/${player.room}/players/${player.id}/x`]: tx,
      [`presence/${player.room}/players/${player.id}/y`]: ty,
    })
  }
}
