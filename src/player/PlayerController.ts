/**
 * PlayerController — keyboard input, client-predicted movement, Firebase sync,
 * and room-transition triggers (house entry / exit, dungeon entry / exit).
 *
 * Room entry: press E when adjacent to a building or dungeon-entrance tile.
 * Room exit: press E when standing on a portal_exit or dungeon_stairs_up tile.
 *
 * The controller emits two scene events that GameScene handles:
 *   'enterRoom' { roomId: string, spawnX: number, spawnY: number }
 *   'exitRoom'  { returnX: number, returnY: number }
 */
import Phaser from 'phaser'
import { db } from '../firebase.ts'
import { ref, update } from 'firebase/database'
import { getLocalPlayer, setLocalPlayer } from './Auth.ts'
import { isPassable, getSpeedMod } from '../world/CollisionMap.ts'
import { ensureRadius, tileToChunk, getActiveRoom } from '../world/ChunkManager.ts'
import { TILE_SIZE, getTileEntryType, isTileRoomExit } from '../renderer/TilemapRenderer.ts'
import { getTile } from '../world/ChunkManager.ts'
import { houseRoomId, HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { dungeonRoomId } from '../world/DungeonGen.ts'

/** Pixels per second at base speed. */
const BASE_SPEED = 80
/** Time in ms between Firebase position writes. */
const SYNC_INTERVAL = 100

export class PlayerController {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key }
  private interactKey!: Phaser.Input.Keyboard.Key
  private sprite!: Phaser.GameObjects.Image
  private lastSync = 0
  private lastChunk = ''

  /** Saved overworld tile position before entering a room. */
  private _returnX = 0
  private _returnY = 0

  /** World-pixel position (not tile). */
  px = 0
  py = 0

  private scene: Phaser.Scene
  constructor(scene: Phaser.Scene) { this.scene = scene }

  create(): void {
    const player = getLocalPlayer()

    // If the player logged out inside a room, return them to the overworld
    // at their saved return position rather than spawning at room-local coords.
    if (player.room !== '0') {
      const rx = player.returnX ?? player.x
      const ry = player.returnY ?? player.y
      player.room = '0'
      player.x = rx
      player.y = ry
      setLocalPlayer(player)
      void update(ref(db), {
        [`players/${player.id}/room`]: '0',
        [`players/${player.id}/x`]: rx,
        [`players/${player.id}/y`]: ry,
      })
    }

    this.px = player.x * TILE_SIZE + TILE_SIZE / 2
    this.py = player.y * TILE_SIZE + TILE_SIZE / 2

    // Player sprite — champion spritesheet, frame 0 (global sprite convention)
    this.sprite = this.scene.add.image(this.px, this.py, player.championId)
    this.sprite.setFrame(0)
    this.sprite.setDepth(10)

    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys()
      this.wasd = {
        up:    this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down:  this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left:  this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      }
      this.interactKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E)
    }

    // Follow camera — lerp 1 = instant snap so tiles are always in view
    this.scene.cameras.main.startFollow(this.sprite, true, 1, 1)
    this.scene.cameras.main.setBounds(0, 0, 1000 * TILE_SIZE, 1000 * TILE_SIZE)
    this.scene.cameras.main.setZoom(1)
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

    // Interact key — E
    if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this._handleInteract()
    }
  }

  /**
   * Handle the E-key interaction:
   * - If in a room and standing on portal_exit/dungeon_stairs_up → exit room
   * - If on overworld and adjacent to an enterable building → enter its room
   */
  private _handleInteract(): void {
    const tx = Math.floor(this.px / TILE_SIZE)
    const ty = Math.floor(this.py / TILE_SIZE)

    if (getActiveRoom() !== null) {
      // Inside a room — check current tile and adjacent tiles for room exit
      const currentTile = getTile(tx, ty)
      const tileTypes = [
        currentTile?.g,
        ...(currentTile?.m ?? []),
        ...this._adjacentTileTypes(tx, ty),
      ].filter(Boolean) as string[]

      if (tileTypes.some(t => isTileRoomExit(t))) {
        this.scene.events.emit('exitRoom', { returnX: this._returnX, returnY: this._returnY })
      }
      return
    }

    // Overworld — check adjacent tiles for enterable buildings
    const adjacentOffsets = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]
    for (const { dx, dy } of adjacentOffsets) {
      const atx = tx + dx
      const aty = ty + dy
      const tile = getTile(atx, aty)
      if (!tile) continue

      // Check all tile layers for entry type
      const allTypes = [tile.g, ...(tile.m ?? [])]
      for (const type of allTypes) {
        const entryType = getTileEntryType(type)
        if (entryType === 'house') {
          this._returnX = tx
          this._returnY = ty
          this._persistReturnPos(tx, ty)
          const roomId = houseRoomId(atx, aty)
          const spawnX = Math.floor(HOUSE_ROOM_SIZE / 2)
          const spawnY = HOUSE_ROOM_SIZE - 3
          this.scene.events.emit('enterRoom', { roomId, spawnX, spawnY })
          return
        }
        if (entryType === 'dungeon') {
          this._returnX = tx
          this._returnY = ty
          this._persistReturnPos(tx, ty)
          // Dungeon entrance tile itself is at (atx, aty); room ID is derived
          const roomId = dungeonRoomId(atx, aty, 1)
          const spawnX = 2
          const spawnY = 2
          this.scene.events.emit('enterRoom', { roomId, spawnX, spawnY })
          return
        }
      }
    }
  }

  /** Persist the overworld return position to Firebase so login can restore it. */
  private _persistReturnPos(tx: number, ty: number): void {
    const player = getLocalPlayer()
    player.returnX = tx
    player.returnY = ty
    setLocalPlayer(player)
    void update(ref(db), {
      [`players/${player.id}/returnX`]: tx,
      [`players/${player.id}/returnY`]: ty,
    })
  }

  /** Returns the tile type strings of the 4 tiles adjacent to (tx, ty). */
  private _adjacentTileTypes(tx: number, ty: number): string[] {
    const offsets = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]
    const types: string[] = []
    for (const { dx, dy } of offsets) {
      const tile = getTile(tx + dx, ty + dy)
      if (tile) types.push(tile.g, ...(tile.m ?? []))
    }
    return types
  }

  /** Move the player sprite to a specific tile position (used on room transitions). */
  teleport(tx: number, ty: number): void {
    this.px = tx * TILE_SIZE + TILE_SIZE / 2
    this.py = ty * TILE_SIZE + TILE_SIZE / 2
    this.sprite.setPosition(this.px, this.py)
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
