/**
 * PlayerController — keyboard input, client-predicted movement, Firebase sync,
 * and room-transition triggers (house entry / exit, dungeon entry / exit).
 *
 * Room entry: step onto a dungeon_entrance tile OR walk up to a building tile.
 * Room exit: step onto a house_exit or dungeon_stairs_up tile.
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
import { houseRoomId, parseHouseRoomId, HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { dungeonRoomId, parseDungeonRoomId } from '../world/DungeonGen.ts'
import { cellarRoomId, parseCellarRoomId } from '../world/CellarGen.ts'

/** Pixels per second at base speed. */
const BASE_SPEED = 80
/** Time in ms between Firebase position writes. */
const SYNC_INTERVAL = 100

export class PlayerController {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key }
  private sprite!: Phaser.GameObjects.Image
  private lastSync = 0
  private lastChunk = ''

  /** Cooldown (ms) to prevent re-triggering a room transition immediately after one fires. */
  private _transitionCooldown = 0

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

    // Auto room-transition: trigger when touching an entry/exit tile
    if (this._transitionCooldown > 0) {
      this._transitionCooldown -= delta
    } else {
      this._checkTileTransition()
    }
  }

  /**
   * Auto room-transition: fires every frame when cooldown is zero.
   * - If in a room and standing on a house_exit/dungeon_stairs_up tile → exit room
   * - If on overworld and standing on a passable entry tile (dungeon_entrance)
   *   OR adjacent to an impassable entry tile (building) → enter its room
   */
  private _checkTileTransition(): void {
    const tx = Math.floor(this.px / TILE_SIZE)
    const ty = Math.floor(this.py / TILE_SIZE)

    if (getActiveRoom() !== null) {
      // Inside a room — check only the current tile for a room-exit marker
      const currentTile = getTile(tx, ty)
      const tileTypes = [
        currentTile?.g,
        ...(currentTile?.m ?? []),
      ].filter(Boolean) as string[]

      if (tileTypes.includes('dungeon_stairs_down')) {
        const activeRoom = getActiveRoom()!

        // House cellar entrance: house_XXXX_YYYY -> cellar_XXXX_YYYY
        if (activeRoom.startsWith('house_')) {
          const parsed = parseHouseRoomId(activeRoom)
          if (parsed) {
            const roomId = cellarRoomId(parsed.tx, parsed.ty)
            this._transitionCooldown = 800
            this._persistRoomOnly(roomId)
            this.scene.events.emit('enterRoom', { roomId, spawnX: 2, spawnY: 2 })
            return
          }
        }

        // Dungeon floor descent: dungeon_XXXX_YYYY_floor_N -> floor N+1
        const d = parseDungeonRoomId(activeRoom)
        if (d) {
          const roomId = dungeonRoomId(d.tx, d.ty, d.floor + 1)
          this._transitionCooldown = 800
          this._persistRoomOnly(roomId)
          this.scene.events.emit('enterRoom', { roomId, spawnX: 2, spawnY: 2 })
          return
        }
      }

      if (tileTypes.includes('dungeon_stairs_up')) {
        const activeRoom = getActiveRoom()!

        // Cellar ascent returns to the source house interior.
        if (activeRoom.startsWith('cellar_')) {
          const parsed = parseCellarRoomId(activeRoom)
          if (parsed) {
            const roomId = houseRoomId(parsed.tx, parsed.ty)
            this._transitionCooldown = 800
            this._persistRoomOnly(roomId)
            const spawnX = Math.floor(HOUSE_ROOM_SIZE / 2)
            const spawnY = HOUSE_ROOM_SIZE - 3
            this.scene.events.emit('enterRoom', { roomId, spawnX, spawnY })
            return
          }
        }

        // Dungeon floor ascent: floor N>1 goes to N-1, floor 1 exits overworld.
        const d = parseDungeonRoomId(activeRoom)
        if (d) {
          if (d.floor > 1) {
            const roomId = dungeonRoomId(d.tx, d.ty, d.floor - 1)
            this._transitionCooldown = 800
            this._persistRoomOnly(roomId)
            this.scene.events.emit('enterRoom', { roomId, spawnX: 2, spawnY: 2 })
            return
          }
        }
      }

      if (tileTypes.some(t => isTileRoomExit(t))) {
        this._transitionCooldown = 800
        // Reset room in Firebase immediately so re-login lands on overworld
        const player = getLocalPlayer()
        player.room = '0'
        player.x = this._returnX
        player.y = this._returnY
        setLocalPlayer(player)
        void update(ref(db), {
          [`players/${player.id}/room`]: '0',
          [`players/${player.id}/x`]: this._returnX,
          [`players/${player.id}/y`]: this._returnY,
        })
        this.scene.events.emit('exitRoom', { returnX: this._returnX, returnY: this._returnY })
      }
      return
    }

    // Overworld — check current tile first (passable entry tiles like dungeon_entrance)
    const currentTile = getTile(tx, ty)
    if (currentTile) {
      const allTypes = [currentTile.g, ...(currentTile.m ?? [])]
      for (const type of allTypes) {
        const entryType = getTileEntryType(type)
        if (entryType === 'dungeon') {
          this._transitionCooldown = 800
          // Return position: step back 2 tiles from the entrance so the player
          // doesn't land on it again. Try each cardinal direction until a
          // passable non-entrance tile is found; fall back to the entrance itself.
          const candidates = [
            { rx: tx, ry: ty + 2 },
            { rx: tx, ry: ty - 2 },
            { rx: tx + 2, ry: ty },
            { rx: tx - 2, ry: ty },
          ]
          let retX = tx
          let retY = ty
          for (const { rx, ry } of candidates) {
            const cTile = getTile(rx, ry)
            const cTypes = cTile ? [cTile.g, ...(cTile.m ?? [])] : []
            if (isPassable(rx, ry) && !cTypes.some(t => getTileEntryType(t) === 'dungeon')) {
              retX = rx; retY = ry; break
            }
          }
          this._returnX = retX
          this._returnY = retY
          const roomId = dungeonRoomId(tx, ty, 1)
          this._persistReturnPos(retX, retY, roomId)
          this.scene.events.emit('enterRoom', { roomId, spawnX: 2, spawnY: 2 })
          return
        }
      }
    }

    // Overworld — check adjacent tiles for impassable entry tiles (buildings).
    // Guard with pixel proximity so the trigger only fires when the player's
    // centre is within half a tile of the shared boundary (i.e. actually touching).
    const ENTRY_THRESHOLD = TILE_SIZE / 2
    const adjacentOffsets = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]
    for (const { dx, dy } of adjacentOffsets) {
      // Skip this direction if the player is still more than ENTRY_THRESHOLD px
      // away from the tile boundary shared with the candidate building tile.
      if (dx === 1  && this.px < (tx + 1) * TILE_SIZE - ENTRY_THRESHOLD) continue
      if (dx === -1 && this.px > tx       * TILE_SIZE + ENTRY_THRESHOLD) continue
      if (dy === 1  && this.py < (ty + 1) * TILE_SIZE - ENTRY_THRESHOLD) continue
      if (dy === -1 && this.py > ty       * TILE_SIZE + ENTRY_THRESHOLD) continue

      const atx = tx + dx
      const aty = ty + dy
      const tile = getTile(atx, aty)
      if (!tile) continue

      const allTypes = [tile.g, ...(tile.m ?? [])]
      for (const type of allTypes) {
        const entryType = getTileEntryType(type)
        if (entryType === 'house') {
          this._transitionCooldown = 800
          this._returnX = tx
          this._returnY = ty
          const roomId = houseRoomId(atx, aty)
          this._persistReturnPos(tx, ty, roomId)
          const spawnX = Math.floor(HOUSE_ROOM_SIZE / 2)
          const spawnY = HOUSE_ROOM_SIZE - 3
          this.scene.events.emit('enterRoom', { roomId, spawnX, spawnY })
          return
        }
      }
    }
  }

  /** Persist the overworld return position and active room to Firebase so re-login restores state. */
  private _persistReturnPos(tx: number, ty: number, roomId: string): void {
    const player = getLocalPlayer()
    player.returnX = tx
    player.returnY = ty
    player.room = roomId
    setLocalPlayer(player)
    void update(ref(db), {
      [`players/${player.id}/returnX`]: tx,
      [`players/${player.id}/returnY`]: ty,
      [`players/${player.id}/room`]: roomId,
    })
  }

  /** Persist room-only transitions while keeping original overworld return coordinates. */
  private _persistRoomOnly(roomId: string): void {
    const player = getLocalPlayer()
    player.room = roomId
    setLocalPlayer(player)
    void update(ref(db), {
      [`players/${player.id}/room`]: roomId,
    })
  }

  /** Move the player sprite to a specific tile position (used on room transitions). */
  teleport(tx: number, ty: number): void {
    this.px = tx * TILE_SIZE + TILE_SIZE / 2
    this.py = ty * TILE_SIZE + TILE_SIZE / 2
    this.sprite.setPosition(this.px, this.py)
  }

  /** Re-attach the main camera to follow the player sprite. */
  startCameraFollow(): void {
    this.scene.cameras.main.startFollow(this.sprite, true, 1, 1)
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
