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
import { isPassable, isPassableForPlayer, getSpeedMod } from '../world/CollisionMap.ts'
import { ensureRadius, tileToChunk, getActiveRoom } from '../world/ChunkManager.ts'
import { TILE_SIZE, getTileEntryType, isTileRoomExit } from '../renderer/TilemapRenderer.ts'
import type { Direction } from '../renderer/SpriteAnim.ts'
import { ANIM_FRAMES, FRAME_DURATION_MS, getFrame, getAttackFrame, directionFromVelocity } from '../renderer/SpriteAnim.ts'
import { getTile } from '../world/ChunkManager.ts'
import { houseRoomId, parseHouseRoomId, HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { dungeonRoomId, parseDungeonRoomId } from '../world/DungeonGen.ts'
import { cellarRoomId, parseCellarRoomId } from '../world/CellarGen.ts'
import { isRoomLocked } from '../world/RoomState.ts'
import { virtualInput } from '../input/VirtualInput.ts'

/** Pixels per second at base speed. */
const BASE_SPEED = 80
/** Time in ms between Firebase position writes. */
const SYNC_INTERVAL = 100

export class PlayerController {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private sprite!: Phaser.GameObjects.Sprite
  private lastSync = 0
  private lastChunk = ''

  private _direction: Direction = 'down'
  private _lastSyncedDirection: Direction = 'down'
  private _animFrame = 0
  private _animTimer = 0

  /** Cooldown (ms) to prevent re-triggering a room transition immediately after one fires. */
  private _transitionCooldown = 0

  /** A key for interact / attack / action. */
  private aKey: Phaser.Input.Keyboard.Key | null = null
  /** Cooldown (ms) between attacks. */
  private _attackCooldown = 0
  /** Current frame index of the attack animation. */
  private _attackAnimFrame = 0
  /** Time accumulator for the attack animation. */
  private _attackAnimTimer = 0

  /** Saved overworld tile position before entering a room. */
  private _returnX = 0
  private _returnY = 0

  /** When true, all movement and attack input is suppressed (e.g. during death). */
  private _frozen = false

  /** Previous-frame state of virtualInput.action — used for rising-edge detection. */
  private _prevVirtualAction = false

  /** World-pixel position (not tile). */
  px = 0
  py = 0

  private scene: Phaser.Scene
  constructor(scene: Phaser.Scene) { this.scene = scene }

  create(): void {
    const player = getLocalPlayer()

    this.px = player.x * TILE_SIZE + TILE_SIZE / 2
    this.py = player.y * TILE_SIZE + TILE_SIZE / 2

    // Restore the overworld exit-target so the door sends the player back to
    // the correct tile instead of defaulting to (0,0) after a re-login.
    if (player.room !== '0') {
      this._returnX = player.returnX ?? player.x
      this._returnY = player.returnY ?? player.y
    }

    // Player sprite — champion spritesheet, frame 0 (global sprite convention)
    this.sprite = this.scene.add.sprite(this.px, this.py, player.championId)
    this.sprite.setFrame(0)
    this.sprite.setDepth(10)

    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys()
      this.aKey    = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A)
    }

    // Follow camera — lerp 1 = instant snap so tiles are always in view
    this.scene.cameras.main.startFollow(this.sprite, true, 1, 1)
    this.scene.cameras.main.setBounds(0, 0, 1000 * TILE_SIZE, 1000 * TILE_SIZE)
    // Zoom is set by GameScene after create() returns, so no override here
  }

  update(delta: number): void {
    if (!this.cursors || this._frozen) return

    // Freeze movement while the chat input (or any text input) has keyboard focus
    if (document.activeElement instanceof HTMLInputElement) return

    const up    = this.cursors.up.isDown    || virtualInput.up
    const down  = this.cursors.down.isDown  || virtualInput.down
    const left  = this.cursors.left.isDown  || virtualInput.left
    const right = this.cursors.right.isDown || virtualInput.right

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

      if (isPassableForPlayer(ntx, ty))  this.px = nx
      if (isPassableForPlayer(tx, nty))  this.py = ny

      this.sprite.setPosition(this.px, this.py)

      // Lazy-load chunks as player moves
      const ck = tileToChunk(Math.floor(this.px / TILE_SIZE), Math.floor(this.py / TILE_SIZE))
      if (ck !== this.lastChunk) {
        this.lastChunk = ck
        const [cxStr, cyStr] = ck.split('_')
        void ensureRadius(parseInt(cxStr), parseInt(cyStr), 2)
      }
    }

    // Direction and walk animation
    if (vx !== 0 || vy !== 0) {
      this._direction = directionFromVelocity(vx, vy, this._direction)
      this._animTimer += delta
      if (this._animTimer >= FRAME_DURATION_MS) {
        this._animTimer -= FRAME_DURATION_MS
        this._animFrame = (this._animFrame + 1) % ANIM_FRAMES
      }
    } else {
      this._animFrame = 0
      this._animTimer = 0
    }

    // Attack animation overrides walk frame while cooldown is active
    if (this._attackCooldown > 0) {
      this._attackAnimTimer += delta
      if (this._attackAnimTimer >= FRAME_DURATION_MS) {
        this._attackAnimTimer -= FRAME_DURATION_MS
        // Advance but clamp at last frame (hold pose until cooldown ends)
        this._attackAnimFrame = Math.min(this._attackAnimFrame + 1, ANIM_FRAMES - 1)
      }
      this.sprite.setFrame(getAttackFrame(this._direction, this._attackAnimFrame))
    } else {
      this.sprite.setFrame(getFrame(this._direction, this._animFrame))
    }

    // Sync to Firebase at throttled interval
    this.lastSync += delta
    if (this.lastSync >= SYNC_INTERVAL) {
      this.lastSync = 0
      this._syncPosition()
    }

    // Attack / interact — A key or D-pad action button (rising edge only)
    if (this._attackCooldown > 0) this._attackCooldown -= delta
    const vActionRising = virtualInput.action && !this._prevVirtualAction
    this._prevVirtualAction = virtualInput.action
    if (this._attackCooldown <= 0
        && (this.aKey?.isDown || vActionRising)
        && !(document.activeElement instanceof HTMLInputElement)) {
      const tx = Math.floor(this.px / TILE_SIZE)
      const ty = Math.floor(this.py / TILE_SIZE)
      this.scene.events.emit('playerAttack', { tx, ty, direction: this._direction })
      this._attackCooldown = 500
      this._attackAnimFrame = 0
      this._attackAnimTimer = 0
    }

    // Auto room-transition: trigger when touching an entry/exit tile
    if (this._transitionCooldown > 0) {
      this._transitionCooldown -= delta
    } else {
      this._checkTileTransition()
    }
  }

  /**
   * Returns true when the player's pixel centre is within 20% of TILE_SIZE
   * from the centre of tile (tx, ty) — i.e. the player sprite is fully centred
   * on the transition tile before a room transition is allowed to fire.
   */
  private _isOnTile(tx: number, ty: number): boolean {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2
    const cy = ty * TILE_SIZE + TILE_SIZE / 2
    // Stricter: must be within 10% of TILE_SIZE from center
    return Math.abs(this.px - cx) < TILE_SIZE * 0.1
      && Math.abs(this.py - cy) < TILE_SIZE * 0.1
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
      // Inside a room — only trigger when solidly centred on the tile.
      if (!this._isOnTile(tx, ty)) return
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
            this.scene.events.emit('enterRoom', { roomId, spawnNear: 'cellar_stairs_up' })
            return
          }
        }

        // Dungeon floor descent: dungeon_XXXX_YYYY_floor_N -> floor N+1
        const d = parseDungeonRoomId(activeRoom)
        if (d) {
          const roomId = dungeonRoomId(d.tx, d.ty, d.floor + 1)
          this._transitionCooldown = 800
          this._persistRoomOnly(roomId)
          this.scene.events.emit('enterRoom', { roomId, spawnNear: 'dungeon_stairs_up' })
          return
        }
      }

      // cellar_stairs_up → return to the source house interior
      if (tileTypes.includes('cellar_stairs_up')) {
        const activeRoom = getActiveRoom()!
        if (activeRoom.startsWith('cellar_')) {
          const parsed = parseCellarRoomId(activeRoom)
          if (parsed) {
            const roomId = houseRoomId(parsed.tx, parsed.ty)
            this._transitionCooldown = 800
            this._persistRoomOnly(roomId)
            this.scene.events.emit('enterRoom', { roomId, spawnNear: 'dungeon_stairs_down' })
            return
          }
        }
      }

      if (tileTypes.includes('dungeon_stairs_up')) {
        const activeRoom = getActiveRoom()!

        // Dungeon floor ascent: floor N>1 goes to N-1, floor 1 exits overworld.
        const d = parseDungeonRoomId(activeRoom)
        if (d) {
          if (d.floor > 1) {
            if (isRoomLocked()) {
              this._transitionCooldown = 800
              this.scene.events.emit('hint', 'Defeat the boss to unlock the exit!')
              return
            }
            const roomId = dungeonRoomId(d.tx, d.ty, d.floor - 1)
            this._transitionCooldown = 800
            this._persistRoomOnly(roomId)
            this.scene.events.emit('enterRoom', { roomId, spawnNear: 'dungeon_stairs_down' })
            return
          }
        }
      }

      if (tileTypes.some(t => isTileRoomExit(t))) {
        // Block exit from any dungeon floor while the boss is aggroed.
        if (getActiveRoom()?.startsWith('dungeon_') && isRoomLocked()) {
          this._transitionCooldown = 800
          this.scene.events.emit('hint', 'Defeat the boss to unlock the exit!')
          return
        }
        this._transitionCooldown = 800
        const player = getLocalPlayer()
        const oldRoom = player.room
        player.room = '0'
        player.x = this._returnX
        player.y = this._returnY
        setLocalPlayer(player)
        // Remove from room presence; restore full overworld presence entry
        void update(ref(db), {
          [`players/${player.id}/room`]: '0',
          [`players/${player.id}/x`]: this._returnX,
          [`players/${player.id}/y`]: this._returnY,
          [`presence/${oldRoom}/players/${player.id}`]: null,
          [`presence/0/players/${player.id}/x`]: this._returnX,
          [`presence/0/players/${player.id}/y`]: this._returnY,
          [`presence/0/players/${player.id}/name`]: player.name,
          [`presence/0/players/${player.id}/level`]: player.level,
          [`presence/0/players/${player.id}/spriteFrame`]: `${player.championId}.png`,
          [`presence/0/players/${player.id}/state`]: 'idle',
          [`presence/0/players/${player.id}/direction`]: this._direction,
        })
        this.scene.events.emit('exitRoom', { returnX: this._returnX, returnY: this._returnY })
      }
      return
    }

    // Overworld — check current tile first (passable entry tiles like dungeon_entrance).
    // Require the player to be solidly on the tile before triggering.
    if (this._isOnTile(tx, ty)) {
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
            this._persistReturnPos(retX, retY, roomId, 2, 2)
            this.scene.events.emit('enterRoom', { roomId, spawnNear: 'dungeon_stairs_up' })
            return
          }
        }
      }
    }

    // Overworld — check the tile directly above the player for an impassable
    // building entry. Player must be standing in front of the door (feet at the building's south edge).
    const atx = tx
    const aty = ty - 1
    const tile = getTile(atx, aty)
    if (tile && this._isAtHouseDoor(tx, ty)) {
      const allTypes = [tile.g, ...(tile.m ?? [])]
      for (const type of allTypes) {
        const entryType = getTileEntryType(type)
        if (entryType === 'house') {
          this._transitionCooldown = 800
          this._returnX = tx
          this._returnY = ty
          const roomId = houseRoomId(atx, aty)
          const spawnX = Math.floor(HOUSE_ROOM_SIZE / 2)
          const spawnY = HOUSE_ROOM_SIZE - 3
          this._persistReturnPos(tx, ty, roomId, spawnX, spawnY)
          this.scene.events.emit('enterRoom', { roomId, spawnNear: 'house_exit' })
          return
        }
      }
    }
    // ...existing code...
    return;
  }
    /**
     * Returns true if the player's feet are just below the building's south edge (door).
     * Used for house entry alignment.
     */
    private _isAtHouseDoor(tx: number, ty: number): boolean {
      // Player feet Y = py + sprite.height / 2
      // Building bottom Y = (ty-1) * TILE_SIZE + TILE_SIZE
      if (!this.sprite) return false;
      const feetY = this.py + this.sprite.height / 2;
      const doorY = (ty - 1) * TILE_SIZE + TILE_SIZE;
      // Allow a very forgiving threshold (±12px)
      return Math.abs(feetY - doorY) <= 12 && Math.abs(this.px - (tx * TILE_SIZE + TILE_SIZE / 2)) < TILE_SIZE * 0.1;
    }

  /**
   * Persist the overworld return position and active room to Firebase so re-login
   * restores state. Also atomically removes the player from the old presence room
   * and writes a full initial entry in the new room.
   */
  private _persistReturnPos(
    tx: number, ty: number,
    roomId: string,
    spawnX: number, spawnY: number,
  ): void {
    const player = getLocalPlayer()
    const oldRoom = player.room
    player.returnX = tx
    player.returnY = ty
    player.room = roomId
    setLocalPlayer(player)
    // null removes the old-room presence entry in a single multi-path write
    void update(ref(db), {
      [`players/${player.id}/returnX`]: tx,
      [`players/${player.id}/returnY`]: ty,
      [`players/${player.id}/room`]: roomId,
      [`presence/${oldRoom}/players/${player.id}`]: null,
      [`presence/${roomId}/players/${player.id}/x`]: spawnX,
      [`presence/${roomId}/players/${player.id}/y`]: spawnY,
      [`presence/${roomId}/players/${player.id}/name`]: player.name,
      [`presence/${roomId}/players/${player.id}/level`]: player.level,
      [`presence/${roomId}/players/${player.id}/spriteFrame`]: `${player.championId}.png`,
      [`presence/${roomId}/players/${player.id}/state`]: 'idle',
      [`presence/${roomId}/players/${player.id}/direction`]: this._direction,
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

  /** Suppress all player input (during death animation, cutscenes). */
  freeze(): void {
    this._frozen = true
  }

  /** Resume normal player input. */
  unfreeze(): void {
    this._frozen = false
  }

  /** Flash the player sprite red for 300 ms to indicate incoming damage. */
  flashDamageTint(): void {
    this.sprite.setTint(0xff4444)
    this.scene.time.delayedCall(300, () => {
      if (this.sprite.active) this.sprite.clearTint()
    })
  }

  private _syncPosition(): void {
    const player = getLocalPlayer()
    const tx = Math.floor(this.px / TILE_SIZE)
    const ty = Math.floor(this.py / TILE_SIZE)
    if (tx === player.x && ty === player.y && this._direction === this._lastSyncedDirection) return

    player.x = tx
    player.y = ty
    setLocalPlayer(player)
    this._lastSyncedDirection = this._direction

    void update(ref(db), {
      [`players/${player.id}/x`]: tx,
      [`players/${player.id}/y`]: ty,
      [`presence/${player.room}/players/${player.id}/x`]: tx,
      [`presence/${player.room}/players/${player.id}/y`]: ty,
      [`presence/${player.room}/players/${player.id}/direction`]: this._direction,
    })
  }
}
