/**
 * GameScene — main gameplay: tilemap, player sprite, camera.
 *
 * Listens for 'enterRoom' and 'exitRoom' events from PlayerController to handle
 * transitions between the overworld and house/dungeon interior rooms.
 *
 * Step 5:  subscribes to /presence/{room}/players and renders remote player
 *          sprites with name labels, tweening positions on each Firebase update.
 * Step 6:  subscribes to /presence/{room}/enemies and /presence/{room}/npcs and
 *          renders directional 5-frame entity walk animations.
 * Step 11: I key opens InventoryScene (equipment + bag) as an additive overlay.
 */
import Phaser from 'phaser'
import { ref, onValue, update, runTransaction, get } from 'firebase/database'
import { db } from '../firebase.ts'
import { TilemapRenderer, TILE_SIZE, isTileRoomExit } from '../renderer/TilemapRenderer.ts'
import type { Direction } from '../renderer/SpriteAnim.ts'
import { ANIM_FRAMES, FRAME_DURATION_MS, directionFromVelocity, getFrame } from '../renderer/SpriteAnim.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { enterRoom, exitRoom, findTileInRoom, findAllTilesInRoom, getTile, setTile, getActiveRoom, getWorldZone, ensureRadius, tileToChunk, overworldTilePath } from '../world/ChunkManager.ts'
import { getWorldConfig } from '../world/WorldBootstrap.ts'
import { setRoomLocked } from '../world/RoomState.ts'
import { HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { CELLAR_ROOM_SIZE } from '../world/CellarGen.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { remotePlayerTiles, remoteEnemyTiles, isPassable } from '../world/CollisionMap.ts'
import { xpForLevel, tileKey } from '../world/utils.ts'
import { EnemyRegistry, TileRegistry, ItemRegistry } from '../registry/registries.ts'
import { ScriptExecutor } from '../world/ScriptExecutor.ts'
import type { NearbyPlayer } from '../world/ScriptExecutor.ts'
import type { DialogSceneData } from './DialogScene.ts'
import type { CraftSceneData } from './CraftScene.ts'
import type { ShopSceneData } from './ShopScene.ts'
import type { StorageSceneData } from './StorageScene.ts'
import type { DeathSceneData } from './DeathScene.ts'
import { MusicDirector } from '../audio/MusicDirector.ts'

/** Tile bounds of the 1000×1000 overworld in pixels. */
const WORLD_PIXEL_SIZE = 1000 * TILE_SIZE
const ENTITY_MOVE_DURATION_MS = 180

/** Shape of each entry under /presence/{room}/players/{id}. */
interface PresenceEntry {
  x: number
  y: number
  name: string
  level: number
  spriteFrame: string  // e.g. "champion_warrior.png"
  state: string
  direction: Direction
}

/** Shape of each entry under /presence/{room}/enemies/{id}. */
interface EnemyPresenceEntry {
  x: number
  y: number
  templateId: string
  state: string
  hp: number
}

/** Shape of each entry under /presence/{room}/npcs/{id}. */
interface NpcPresenceEntry {
  x: number
  y: number
  templateId: string
  state: string
}

interface AnimatedEntityRecord<TEntry extends { x: number; y: number }> {
  sprite: Phaser.GameObjects.Sprite
  entry: TEntry
  direction: Direction
  animFrame: number
  animTimer: number
  isMoving: boolean
}

export class GameScene extends Phaser.Scene {
  private tilemapRenderer!: TilemapRenderer
  private playerController!: PlayerController

  /** Remote player sprites keyed by player ID. */
  private _remotePlayers = new Map<string, {
    sprite: Phaser.GameObjects.Sprite
    label: Phaser.GameObjects.Text
    entry: PresenceEntry
  }>()
  /** Enemy sprites keyed by enemy instance ID. */
  private _remoteEnemies = new Map<string, AnimatedEntityRecord<EnemyPresenceEntry>>()
  /** Cached enemy presence data (hp, position, templateId) keyed by instance ID. */
  private _enemyData = new Map<string, EnemyPresenceEntry>()
  /**
   * Authoritative local HP for each enemy while combat is in progress.
   * Set on first hit; never overwritten by Firebase snapshots.
   * Deleted when the enemy dies or leaves the presence snapshot.
   */
  private _localEnemyHp = new Map<string, number>()
  /** NPC sprites keyed by NPC instance ID. */
  private _remoteNpcs = new Map<string, AnimatedEntityRecord<NpcPresenceEntry>>()

  /** Unsubscribe function for the current Firebase presence listener. */
  private _presenceUnsub: (() => void) | null = null
  /** Unsubscribe function for the current Firebase enemy listener. */
  private _enemyUnsub: (() => void) | null = null
  /** Unsubscribe function for the current Firebase NPC listener. */
  private _npcUnsub: (() => void) | null = null

  /** Entity AI runner (Step 9). */
  private readonly _scriptExecutor = new ScriptExecutor()

  /** True while a dungeon boss is aggroed — blocks exits from the room. */
  private _roomLocked = false

  /** True while the death/respawn sequence is in progress. */
  private _isDead = false
  /** Display name of the last entity that damaged the player (for DeathScene). */
  private _lastKillerName: string | null = null
  /** Tile coordinates and room where the player died (for the post-respawn loot hint). */
  private _deathTx   = 0
  private _deathTy   = 0
  private _deathRoom = '0'
  /** Number of item stacks dropped as loot on the last death. */
  private _deathItemsDropped = 0
  /** performance.now() timestamp of the last time enemy damage landed. Used for the invincibility window. */
  private _lastDamageAt = 0
  /** Minimum milliseconds between consecutive enemy hits (invincibility window). */
  private static readonly _INVINCIBILITY_MS = 600

  /** Adaptive background music controller. */
  private _musicDirector: MusicDirector | null = null
  /** Accumulated delta (ms) for the 1 s threat-evaluation tick. */
  private _threatTimer = 0

  /** Accumulated delta (ms) since the last regen tick. Reset whenever the player takes damage. */
  private _healTimer = 0
  /** Milliseconds the player must be out of combat before regen starts ticking. */
  private static readonly _HEAL_OOC_DELAY_MS = 5_000
  /** Milliseconds between regen ticks once out of combat. */
  private static readonly _HEAL_INTERVAL_MS  = 5_000

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
      const cam     = this.cameras.main
      const minZ    = Math.min(window.innerWidth, window.innerHeight) < 600 ? 2 : 1
      const step    = dy > 0 ? -1 : 1
      const newZoom = Phaser.Math.Clamp(cam.zoom + step, minZ, 4)
      cam.setZoom(newZoom)
      localStorage.setItem('rpidigo.zoom', String(newZoom))
    })

    const screenMin   = Math.min(window.innerWidth, window.innerHeight)
    const defaultZoom = screenMin < 600 ? 2 : 1
    const savedZoom   = parseInt(localStorage.getItem('rpidigo.zoom') ?? String(defaultZoom), 10)
    this.cameras.main.setZoom(Phaser.Math.Clamp(savedZoom, defaultZoom, 4))

    // I key — open inventory (Step 11)
    const iKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.I)
    if (iKey) {
      iKey.on('down', () => {
        if (this._isDead) return
        if (this.scene.isActive('DialogScene'))   return
        if (this.scene.isActive('InventoryScene')) return
        this._openInventory()
      })
    }

    // On-screen inventory button emitted by HudScene
    this.game.events.on('openInventory', () => {
      if (this._isDead) return
      if (this.scene.isActive('DialogScene') || this.scene.isActive('InventoryScene')) return
      this._openInventory()
    })

    // Pinch-to-zoom (two-finger touch)
    let _pinchStartDist = 0
    let _pinchStartZoom = 1
    this.input.on('pointerdown', () => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        _pinchStartDist = Phaser.Math.Distance.Between(
          this.input.pointer1.x, this.input.pointer1.y,
          this.input.pointer2.x, this.input.pointer2.y,
        )
        _pinchStartZoom = this.cameras.main.zoom
      }
    })
    this.input.on('pointermove', () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown || _pinchStartDist === 0) return
      const d = Phaser.Math.Distance.Between(
        this.input.pointer1.x, this.input.pointer1.y,
        this.input.pointer2.x, this.input.pointer2.y,
      )
      const minZ = Math.min(window.innerWidth, window.innerHeight) < 600 ? 2 : 1
      this.cameras.main.setZoom(Phaser.Math.Clamp(_pinchStartZoom * (d / _pinchStartDist), minZ, 4))
    })
    this.input.on('pointerup', () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
        if (_pinchStartDist > 0) {
          localStorage.setItem('rpidigo.zoom', String(this.cameras.main.zoom))
          _pinchStartDist = 0
        }
      }
    })

    // Tap / click to interact — tapping an adjacent world tile acts like the A key
    {
      this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (this._isDead) return
        // Ignore taps consumed by DOM overlays (dialogs, inventory, etc.)
        const activeOverlays = ['DialogScene', 'InventoryScene', 'CraftScene',
          'ShopScene', 'StorageScene', 'DeathScene']
        if (activeOverlays.some(s => this.scene.isActive(s))) return
        // Only react to taps, not drags
        if (Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) > 12) return
        const tapTx = Math.floor(p.worldX / TILE_SIZE)
        const tapTy = Math.floor(p.worldY / TILE_SIZE)
        const ptx   = Math.floor(this.playerController.px / TILE_SIZE)
        const pty   = Math.floor(this.playerController.py / TILE_SIZE)
        const dx = tapTx - ptx
        const dy = tapTy - pty
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return
        const dir: Direction = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up')
        void this._handleInteract(ptx, pty, dir)
      })
    }

    // Room transition events emitted by PlayerController
    this.events.on(
      'enterRoom',
      (data: { roomId: string; spawnNear: string }) => {
        void this._handleEnterRoom(data.roomId, data.spawnNear)
      },
    )

    this.events.on(
      'exitRoom',
      (data: { returnX: number; returnY: number }) => {
        this._handleExitRoom(data.returnX, data.returnY)
      },
    )

    // Attack / interact: PlayerController emits this when E is pressed.
    // NPC interaction is checked first; falls back to enemy attack.
    this.events.on(
      'playerAttack',
      (data: { tx: number; ty: number; direction: Direction }) => {
        void this._handleInteract(data.tx, data.ty, data.direction)
      },
    )

    // 'hint' — emitted by PlayerController when a blocked action needs feedback.
    // Shows an orange float above the player's current tile.
    this.events.on('hint', (text: string) => {
      const tx = Math.floor(this.playerController.px / TILE_SIZE)
      const ty = Math.floor(this.playerController.py / TILE_SIZE)
      this._showFloatText(tx, ty, text, '#ff8844')
    })

    // On startup: if the player logged off inside a room, restore them there;
    // otherwise subscribe to the overworld presence channel.
    {
      const p = getLocalPlayer()
      if (p.room !== '0') {
        void this._restoreRoom(p.room, p.x, p.y)
      } else {
        this._subscribePresence('0')
      }
    }

    // Adaptive music — start ambient playlist immediately
    this._musicDirector = new MusicDirector(this)
    this._musicDirector.requestPlaylist('world_ambient')

    // Clean up Firebase listeners when the scene shuts down
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this._presenceUnsub) { this._presenceUnsub(); this._presenceUnsub = null }
      if (this._enemyUnsub)    { this._enemyUnsub();    this._enemyUnsub    = null }
      if (this._npcUnsub)      { this._npcUnsub();      this._npcUnsub      = null }
      this._scriptExecutor.destroy()
      this._musicDirector?.destroy()
      this._musicDirector = null
      if (this.scene.isActive('DeathScene')) this.scene.stop('DeathScene')
      this.game.events.off('openInventory')
    })
  }

  update(_time: number, delta: number): void {
    this.playerController.update(delta)

    // Death may be triggered by remote damage (PVP or another client) — the
    // shared local player object is kept current by HudScene's /players listener.
    if (!this._isDead && getLocalPlayer().hp <= 0) {
      this._triggerDeath()
    }

    // ── Passive HP regen ──────────────────────────────────────────────────────
    // Ticks every _HEAL_INTERVAL_MS, but only while alive, out of combat for
    // at least _HEAL_OOC_DELAY_MS, and below max HP.
    if (!this._isDead) {
      const oocMs = performance.now() - this._lastDamageAt
      const player = getLocalPlayer()
      if (oocMs >= GameScene._HEAL_OOC_DELAY_MS && player.hp < player.maxHp) {
        this._healTimer += delta
        if (this._healTimer >= GameScene._HEAL_INTERVAL_MS) {
          this._healTimer = 0
          this._applyRegen()
        }
      } else {
        // In combat (or at full HP) — keep timer zeroed so the 5 s window
        // starts fresh after the last hit.
        this._healTimer = 0
      }
    }

    // Run entity AI scripts (time-sliced: at most BUDGET_MS wall-clock per frame)
    const tx = Math.floor(this.playerController.px / TILE_SIZE)
    const ty = Math.floor(this.playerController.py / TILE_SIZE)
    this._scriptExecutor.tick(tx, ty, this._buildNearbyPlayers(), (targetPlayerId, damage, killerTemplateId) => {
      if (targetPlayerId === getLocalPlayer().id) {
        this._applyEnemyDamage(damage, killerTemplateId)
      }
    })

    const cam = this.cameras.main
    const v = cam.worldView
    this.tilemapRenderer.drawViewport(
      v.left  - TILE_SIZE,
      v.top   - TILE_SIZE,
      v.right + TILE_SIZE,
      v.bottom + TILE_SIZE,
    )

    for (const rec of this._remoteEnemies.values()) this._tickEntityAnim(rec, delta)
    for (const rec of this._remoteNpcs.values()) this._tickEntityAnim(rec, delta)

    // Evaluate threat every 1 s and pick the appropriate overworld playlist
    if (this._musicDirector) {
      this._threatTimer += delta
      if (this._threatTimer >= 1_000) {
        this._threatTimer = 0
        this._evaluateMusicThreat()
      }
    }
  }

  /**
   * Compute local threat score from enemies within 12 tiles and request the
   * appropriate overworld playlist. Skipped while inside a dungeon room
   * (dungeon playlist is forced on room entry).
   */
  private _evaluateMusicThreat(): void {
    const player = getLocalPlayer()
    if (player.room.startsWith('dungeon_')) return   // dungeon overrides threat logic

    const AGGRESSIVE_STATES = new Set(['chasing', 'hunting', 'charging', 'chase', 'attack'])
    const px = player.x
    const py = player.y
    let score = 0

    for (const [, e] of this._enemyData) {
      const dist = Math.max(Math.abs(e.x - px), Math.abs(e.y - py))
      if (dist > 12) continue
      const weight = (e.templateId.includes('boss') || e.templateId.includes('elite')) ? 2 : 1
      const bonus  = AGGRESSIVE_STATES.has(e.state) ? 1 : 0
      score += weight + bonus
    }

    this._musicDirector?.requestPlaylist(score >= 6 ? 'world_action' : 'world_ambient')
  }

  private _tickEntityAnim<TEntry extends { x: number; y: number }>(
    rec: AnimatedEntityRecord<TEntry>,
    delta: number,
  ): void {
    if (!rec.isMoving) {
      if (rec.animFrame !== 0 || rec.animTimer !== 0) {
        rec.animFrame = 0
        rec.animTimer = 0
        rec.sprite.setFrame(getFrame(rec.direction, 0))
      }
      return
    }
    rec.animTimer += delta
    while (rec.animTimer >= FRAME_DURATION_MS) {
      rec.animTimer -= FRAME_DURATION_MS
      rec.animFrame = (rec.animFrame + 1) % ANIM_FRAMES
    }
    rec.sprite.setFrame(getFrame(rec.direction, rec.animFrame))
  }

  /**
   * Build the NearbyPlayer list passed to ScriptExecutor each tick.
   * Includes the local player and all remote players currently in the room.
   */
  private _buildNearbyPlayers(): NearbyPlayer[] {
    const local = getLocalPlayer()
    const result: NearbyPlayer[] = [{
      id:    local.id,
      name:  local.name,
      x:     local.x,
      y:     local.y,
      level: local.level,
    }]
    for (const [id, { entry }] of this._remotePlayers) {
      result.push({ id, name: entry.name, x: entry.x, y: entry.y, level: entry.level })
    }
    return result
  }

  /**
   * Apply damage from an enemy attack to the local player.
   * Subtracts defense, flashes sprite, writes HP to Firebase, triggers death if HP <= 0.
   */
  private _applyEnemyDamage(rawDamage: number, killerTemplateId?: string): void {
    if (this._isDead) return
    const now = performance.now()
    if (now - this._lastDamageAt < GameScene._INVINCIBILITY_MS) return
    this._lastDamageAt = now
    const player = getLocalPlayer()
    const net = Math.max(1, rawDamage - player.totalDefense)
    const newHp = Math.max(0, player.hp - net)
    player.hp = newHp
    setLocalPlayer(player)

    // Flash the player sprite
    this.playerController.flashDamageTint()

    // Floating damage number above the player
    const dmgText = this.add.text(
      this.playerController.px,
      this.playerController.py - TILE_SIZE,
      `-${net}`,
      { fontFamily: 'monospace', fontSize: '7px', color: '#ff8888', stroke: '#000000', strokeThickness: 2 },
    ).setOrigin(0.5, 1).setDepth(50)
    this.tweens.add({
      targets: dmgText,
      y:       dmgText.y - TILE_SIZE * 1.5,
      alpha:   0,
      duration: 1400,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    })

    void update(ref(db), { [`players/${player.id}/hp`]: newHp })

    if (killerTemplateId) {
      try { this._lastKillerName = EnemyRegistry.get(killerTemplateId).displayName }
      catch { this._lastKillerName = killerTemplateId.replace(/_/g, ' ') }
    }
    if (newHp <= 0) this._triggerDeath()
  }

  /**
   * Passive regen tick — heals 5 % of maxHp, shows a floating green number above
   * the player sprite (mirrors the red damage float), and writes HP to Firebase.
   */
  private _applyRegen(): void {
    const player = getLocalPlayer()
    const amount = Math.max(1, Math.ceil(player.maxHp * 0.05))
    const newHp  = Math.min(player.maxHp, player.hp + amount)
    const gained = newHp - player.hp
    if (gained <= 0) return

    player.hp = newHp
    setLocalPlayer(player)

    // Floating green heal number — same position, size and tween as damage floats
    const healText = this.add.text(
      this.playerController.px,
      this.playerController.py - TILE_SIZE,
      `+${gained}`,
      { fontFamily: 'monospace', fontSize: '7px', color: '#44ff88', stroke: '#000000', strokeThickness: 2 },
    ).setOrigin(0.5, 1).setDepth(50)
    this.tweens.add({
      targets:  healText,
      y:        healText.y - TILE_SIZE * 1.5,
      alpha:    0,
      duration: 1400,
      ease:     'Cubic.easeOut',
      onComplete: () => healText.destroy(),
    })

    void update(ref(db), { [`players/${player.id}/hp`]: newHp })
  }

  /**
   * Trigger the death sequence: freeze input, drop loot, launch DeathScene.
   * DeathScene's SHUTDOWN event fires _respawn() once the countdown or button resolves.
   */
  private _triggerDeath(): void {
    if (this._isDead) return
    this._isDead = true
    this.playerController.freeze()

    const player = getLocalPlayer()
    player.hp = 0

    // Capture death location before dropping loot (uses current player tile).
    this._deathTx   = Math.floor(this.playerController.px / TILE_SIZE)
    this._deathTy   = Math.floor(this.playerController.py / TILE_SIZE)
    this._deathRoom = player.room

    const inv = player.inventory ?? []
    const keptItems  = inv.filter(s => { try { return ItemRegistry.get(s.itemId).category === 'tool' } catch { return false } })
    const droppedItems = inv.filter(s => { try { return ItemRegistry.get(s.itemId).category !== 'tool' } catch { return true } })

    this._deathItemsDropped = droppedItems.length
    this._dropInventoryAsLoot(player.room, droppedItems)
    player.inventory = keptItems
    setLocalPlayer(player)
    void update(ref(db), {
      [`players/${player.id}/hp`]:        0,
      [`players/${player.id}/inventory`]: keptItems,
    })

    const data: DeathSceneData = {
      killerName:   this._lastKillerName,
      goldRetained: player.gold,
      itemsLost:    this._deathItemsDropped,
    }
    this.scene.launch('DeathScene', data)
    this.scene.get('DeathScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => void this._respawn(),
    )
  }

  /**
   * Respawn: restore HP, teleport to player house, exit any active room.
   *
   * Async so we can await the overworld chunk load before unfreezing — without
   * this the renderer has no tile data and the player spawns into a black world
   * with only presence-driven enemy sprites visible.
   */
  private async _respawn(): Promise<void> {
    const player   = getLocalPlayer()
    const oldRoom  = player.room
    const houseTx  = player.house?.x ?? player.x
    const houseTy  = player.house?.y ?? player.y

    // Restore HP
    player.hp   = Math.max(1, Math.floor(player.maxHp * 0.5))
    player.room = '0'
    setLocalPlayer(player)

    // Exit room if the player died inside one
    if (oldRoom !== '0') {
      exitRoom()
      this.tilemapRenderer.reset()
      this.cameras.main.setBounds(0, 0, WORLD_PIXEL_SIZE, WORLD_PIXEL_SIZE)
      this.playerController.startCameraFollow()
    }

    // Point camera toward the house while chunks load (sprite position updated below)
    this.playerController.teleport(houseTx, houseTy)
    this._subscribePresence('0')

    // Load the chunks around the house before checking passability or unfreezing
    const ck = tileToChunk(houseTx, houseTy)
    const [cxStr, cyStr] = ck.split('_')
    await ensureRadius(parseInt(cxStr, 10), parseInt(cyStr, 10), 2)

    // Find a passable tile to land on — the house building tile itself is
    // impassable, so prefer the tile just below the door and fall back outward.
    const candidates: [number, number][] = [
      [houseTx,     houseTy + 1],
      [houseTx,     houseTy + 2],
      [houseTx - 1, houseTy + 1],
      [houseTx + 1, houseTy + 1],
      [houseTx - 1, houseTy],
      [houseTx + 1, houseTy],
    ]
    let [hx, hy] = candidates[0]
    for (const [cx, cy] of candidates) {
      if (isPassable(cx, cy)) { hx = cx; hy = cy; break }
    }

    // Snap sprite to the passable spawn tile and persist
    player.x = hx
    player.y = hy
    setLocalPlayer(player)
    this.playerController.teleport(hx, hy)

    const respawnUpdate: Record<string, unknown> = {
      [`players/${player.id}/hp`]:   player.hp,
      [`players/${player.id}/x`]:    hx,
      [`players/${player.id}/y`]:    hy,
      [`players/${player.id}/room`]: '0',
      [`presence/0/players/${player.id}/x`]:           hx,
      [`presence/0/players/${player.id}/y`]:           hy,
      [`presence/0/players/${player.id}/name`]:        player.name,
      [`presence/0/players/${player.id}/level`]:       player.level,
      [`presence/0/players/${player.id}/spriteFrame`]: `${player.championId}.png`,
      [`presence/0/players/${player.id}/state`]:       'idle',
      [`presence/0/players/${player.id}/direction`]:   'down',
    }
    if (oldRoom !== '0') {
      respawnUpdate[`presence/${oldRoom}/players/${player.id}`] = null
    }
    void update(ref(db), respawnUpdate)

    // Chunks are ready — mark the renderer dirty so drawViewport paints them
    // on the very next update() call, then hand control back to the player.
    this.tilemapRenderer.markDirty()
    this._isDead = false
    this.playerController.unfreeze()

    // If the player dropped items, write a direction hint to the chat so they
    // know where to retrieve their belongings.
    if (this._deathItemsDropped > 0) {
      const hint = this._lootDirectionHint(hx, hy, player.name)
      if (hint) {
        const now = Date.now()
        void update(ref(db), {
          [`chat/0/_loot_hint_${player.id}_${now}`]: {
            sender: 'System', x: hx, y: hy,
            text: hint, timestamp: now, system: true,
          },
        })
      }
    }
  }

  /** Build a proximity-chat hint pointing from (hx,hy) toward the loot chest. */
  private _lootDirectionHint(hx: number, hy: number, playerName: string): string | null {
    const room = this._deathRoom
    let targetX: number
    let targetY: number
    let prefix: string

    if (room === '0') {
      targetX = this._deathTx
      targetY = this._deathTy
      prefix  = `${playerName}'s belongings lie`
    } else {
      // Parse the room ID to find the building's overworld tile coordinates
      const houseM   = /^house_(\d{4})_(\d{4})$/.exec(room)
      const dungeonM = /^dungeon_(\d{4})_(\d{4})_floor_(\d+)$/.exec(room)
      const cellarM  = /^cellar_(\d{4})_(\d{4})$/.exec(room)
      if (houseM) {
        targetX = parseInt(houseM[1], 10); targetY = parseInt(houseM[2], 10)
        prefix  = `${playerName}'s belongings are in a house`
      } else if (dungeonM) {
        targetX = parseInt(dungeonM[1], 10); targetY = parseInt(dungeonM[2], 10)
        prefix  = `${playerName}'s belongings are in a dungeon (floor ${dungeonM[3]})`
      } else if (cellarM) {
        targetX = parseInt(cellarM[1], 10); targetY = parseInt(cellarM[2], 10)
        prefix  = `${playerName}'s belongings are in a cellar`
      } else {
        return null
      }
    }

    const dx   = targetX - hx
    const dy   = targetY - hy
    const dist = Math.round(Math.hypot(dx, dy))
    if (dist < 2) return null  // dropped right here — no hint needed

    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    let dir: string
    if (angle < -157.5 || angle >= 157.5) dir = 'west'
    else if (angle < -112.5) dir = 'north-west'
    else if (angle < -67.5)  dir = 'north'
    else if (angle < -22.5)  dir = 'north-east'
    else if (angle < 22.5)   dir = 'east'
    else if (angle < 67.5)   dir = 'south-east'
    else if (angle < 112.5)  dir = 'south'
    else                     dir = 'south-west'

    return `${prefix} to the ${dir}, ~${dist} tiles away.`
  }

  /**
   * Find the first tile of `tileType` in the loaded room, then return the
   * nearest passable non-trigger adjacent tile (S → E → N → W). Falls back
   * to the anchor itself if no adjacent tile qualifies.
   */
  private _spawnNextTo(tileType: string): { x: number; y: number } {
    const anchor = findTileInRoom(tileType)
    if (anchor) {
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
        const nx = anchor.x + dx
        const ny = anchor.y + dy
        if (!isPassable(nx, ny)) continue
        const t = getTile(nx, ny)
        const types = t ? [t.g, ...(t.m ?? [])] : []
        if (types.some(isTileRoomExit) || types.some(s => s.includes('stairs'))) continue
        return { x: nx, y: ny }
      }
      return anchor
    }
    return { x: 2, y: 2 }
  }

  private async _restoreRoom(roomId: string, spawnX: number, spawnY: number): Promise<void> {
    await enterRoom(roomId)
    this.tilemapRenderer.reset()
    this.playerController.teleport(spawnX, spawnY)

    const roomSize = roomId.startsWith('house_')  ? HOUSE_ROOM_SIZE
                   : roomId.startsWith('cellar_') ? CELLAR_ROOM_SIZE
                   : 40
    const roomPixelSize = roomSize * TILE_SIZE

    if (roomId.startsWith('house_')) {
      this.cameras.main.stopFollow()
      this.cameras.main.removeBounds()
      this.cameras.main.centerOn(roomPixelSize / 2, roomPixelSize / 2)
    } else {
      this.cameras.main.setBounds(0, 0, roomPixelSize, roomPixelSize)
      this.playerController.startCameraFollow()
    }

    this._subscribePresence(roomId)
    if (roomId.startsWith('dungeon_')) {
      this._musicDirector?.requestPlaylist('dungeon_dark_ambient', true)
    }
  }

  private async _handleEnterRoom(roomId: string, spawnNear: string): Promise<void> {
    // Persist room in player record so HUD/presence stays consistent
    const player = getLocalPlayer()
    player.room = roomId
    setLocalPlayer(player)

    await enterRoom(roomId)
    this.tilemapRenderer.reset()
    const { x: spawnX, y: spawnY } = this._spawnNextTo(spawnNear)
    this.playerController.teleport(spawnX, spawnY)

    const roomSize = roomId.startsWith('house_')
      ? HOUSE_ROOM_SIZE
      : roomId.startsWith('cellar_')
        ? CELLAR_ROOM_SIZE
        : 40
    const roomPixelSize = roomSize * TILE_SIZE

    if (roomId.startsWith('house_')) {
      // House rooms are small — stop following and center the room on screen
      this.cameras.main.stopFollow()
      this.cameras.main.removeBounds()
      this.cameras.main.centerOn(roomPixelSize / 2, roomPixelSize / 2)
    } else {
      this.cameras.main.setBounds(0, 0, roomPixelSize, roomPixelSize)
    }

    this._subscribePresence(roomId)

    // Force dungeon playlist when entering any dungeon room
    if (roomId.startsWith('dungeon_')) {
      this._musicDirector?.requestPlaylist('dungeon_dark_ambient', true)
    }
  }

  private _handleExitRoom(returnX: number, returnY: number): void {
    exitRoom()

    const player = getLocalPlayer()
    player.room = '0'
    setLocalPlayer(player)

    this.tilemapRenderer.reset()
    this.playerController.teleport(returnX, returnY)

    // Restore overworld camera bounds and re-follow the player
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_SIZE, WORLD_PIXEL_SIZE)
    this.playerController.startCameraFollow()

    this._subscribePresence('0')
    // Return to overworld playlist; threat re-evaluated on the next 1 s tick
    this._musicDirector?.requestPlaylist('world_ambient', true)
  }

  /**
   * Subscribe to /presence/{room}/players, /presence/{room}/enemies, and
   * /presence/{room}/npcs. Renders sprites for all entities; tweens player
   * positions. Tears down previous listeners before attaching new ones.
   */
  private _subscribePresence(room: string): void {
    // Tear down previous listeners and clear all remote sprites
    if (this._presenceUnsub) { this._presenceUnsub(); this._presenceUnsub = null }
    if (this._enemyUnsub)    { this._enemyUnsub();    this._enemyUnsub    = null }
    if (this._npcUnsub)      { this._npcUnsub();      this._npcUnsub      = null }

    for (const { sprite, label } of this._remotePlayers.values()) {
      sprite.destroy(); label.destroy()
    }
    this._remotePlayers.clear()
    remotePlayerTiles.clear()

    for (const { sprite } of this._remoteEnemies.values()) {
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this._remoteEnemies.clear()
    this._enemyData.clear()
    this._localEnemyHp.clear()
    remoteEnemyTiles.clear()

    for (const { sprite } of this._remoteNpcs.values()) {
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this._remoteNpcs.clear()

    // Clear boss lock whenever we switch rooms
    this._roomLocked = false
    setRoomLocked(false)

    // Tell the AI executor about the room change
    this._scriptExecutor.setRoom(room)

    const localId = getLocalPlayer().id
    const presRef = ref(db, `presence/${room}/players`)

    this._presenceUnsub = onValue(presRef, (snap) => {
      const data = snap.val() as Record<string, PresenceEntry> | null
      const incoming = new Set<string>()

      // Rebuild occupied tiles from the full snapshot each update
      remotePlayerTiles.clear()

      if (data) {
        for (const [id, entry] of Object.entries(data)) {
          if (id === localId) continue  // never render self
          incoming.add(id)
          remotePlayerTiles.add(`${entry.x}_${entry.y}`)

          const px = entry.x * TILE_SIZE + TILE_SIZE / 2
          const py = entry.y * TILE_SIZE + TILE_SIZE / 2

          if (this._remotePlayers.has(id)) {
            // Tween existing sprite to the new position; label tracks the sprite
            const rec = this._remotePlayers.get(id)!
            rec.entry = entry  // keep cached entry current
            const { sprite, label } = rec
            this.tweens.add({
              targets: sprite,
              x: px, y: py,
              duration: 180,
              ease: 'Linear',
              onUpdate: () => label.setPosition(sprite.x, sprite.y - TILE_SIZE - 2),
            })
            sprite.setFrame(getFrame(entry.direction ?? 'down', 0))
          } else {
            // First appearance — create sprite and name label
            const textureKey = entry.spriteFrame.replace('.png', '')
            const sprite = this.add.sprite(px, py, textureKey)
              .setFrame(getFrame(entry.direction ?? 'down', 0))
              .setDepth(10)
            const label = this.add.text(px, py - TILE_SIZE - 2, entry.name, {
              fontFamily: 'monospace',
              fontSize: '8px',
              color: '#ffffff',
              stroke: '#000000',
              strokeThickness: 2,
            }).setOrigin(0.5, 1).setDepth(11)
            this._remotePlayers.set(id, { sprite, label, entry })
          }
        }
      }

      // Destroy sprites for players who left the room
      for (const [id, { sprite, label }] of this._remotePlayers.entries()) {
        if (!incoming.has(id)) {
          sprite.destroy(); label.destroy()
          this._remotePlayers.delete(id)
        }
      }
    })

    // ── Enemy sprites ──────────────────────────────────────────────────────
    const enemyRef = ref(db, `presence/${room}/enemies`)
    this._enemyUnsub = onValue(enemyRef, (snap) => {
      const data = snap.val() as Record<string, EnemyPresenceEntry> | null
      const incoming = new Set<string>()

      // Rebuild occupied tiles from the full snapshot
      remoteEnemyTiles.clear()

      if (data) {
        for (const [id, entry] of Object.entries(data)) {
          incoming.add(id)
          const px = entry.x * TILE_SIZE + TILE_SIZE / 2
          const py = entry.y * TILE_SIZE + TILE_SIZE / 2

          // Always refresh cached data (hp may have changed)
          this._enemyData.set(id, { ...entry })
          remoteEnemyTiles.add(`${entry.x}_${entry.y}`)

          if (this._remoteEnemies.has(id)) {
            const rec = this._remoteEnemies.get(id)!
            const old = rec.entry
            rec.entry = entry
            if (entry.x !== old.x || entry.y !== old.y) {
              this.tweens.killTweensOf(rec.sprite)
              rec.direction = directionFromVelocity(px - rec.sprite.x, py - rec.sprite.y, rec.direction)
              rec.isMoving = true
              this.tweens.add({
                targets: rec.sprite,
                x: px, y: py,
                duration: ENTITY_MOVE_DURATION_MS,
                ease: 'Linear',
                onComplete: () => {
                  if (!rec.sprite.active) return
                  rec.isMoving = false
                  rec.animFrame = 0
                  rec.animTimer = 0
                  rec.sprite.setFrame(getFrame(rec.direction, 0))
                },
              })
            }
          } else {
            let textureKey = 'Enemies/wolf' // fallback
            try {
              const def = EnemyRegistry.get(entry.templateId)
              textureKey = `Enemies/${def.spriteFrame.replace('.png', '')}`
            } catch { /* unknown template — use fallback */ }
            const sprite = this.add.sprite(px, py, textureKey)
              .setFrame(getFrame('down', 0))
              .setDepth(9)
            this._remoteEnemies.set(id, {
              sprite,
              entry,
              direction: 'down',
              animFrame: 0,
              animTimer: 0,
              isMoving: false,
            })
          }
        }
      }

      for (const [id, rec] of this._remoteEnemies.entries()) {
        if (!incoming.has(id)) {
          this.tweens.killTweensOf(rec.sprite)
          rec.sprite.destroy()
          this._remoteEnemies.delete(id)
          this._enemyData.delete(id)
          this._localEnemyHp.delete(id)
          // remoteEnemyTiles already rebuilt from snapshot above
        }
      }

      // Boss aggro-lock: seal the room when the boss leaves idle state;
      // unseal when it dies (removed from presence) or returns to idle.
      const inDungeon = getActiveRoom()?.startsWith('dungeon_') ?? false
      const newLocked = inDungeon && [...this._enemyData.values()].some(
        e => e.templateId === 'dungeon_boss_strong' && e.state !== 'idle',
      )
      if (newLocked !== this._roomLocked) {
        this._roomLocked = newLocked
        setRoomLocked(newLocked)
        const bossRoom = getActiveRoom()!
        const now      = Date.now()
        void update(ref(db), {
          [`chat/${bossRoom}/_bosslock_${now}`]: {
            sender:    'System',
            x: 0, y: 0,
            text:      newLocked
              ? '⚠ The Dragon Lord has awakened! The room is sealed.'
              : '✓ The boss has been defeated. The room is unsealed.',
            timestamp: now,
            system:    true,
          },
        })
      }
    })

    // ── NPC sprites ────────────────────────────────────────────────────────
    const npcRef = ref(db, `presence/${room}/npcs`)
    this._npcUnsub = onValue(npcRef, (snap) => {
      const data = snap.val() as Record<string, NpcPresenceEntry> | null
      const incoming = new Set<string>()

      if (data) {
        for (const [id, entry] of Object.entries(data)) {
          incoming.add(id)
          const px = entry.x * TILE_SIZE + TILE_SIZE / 2
          const py = entry.y * TILE_SIZE + TILE_SIZE / 2

          if (this._remoteNpcs.has(id)) {
            const rec = this._remoteNpcs.get(id)!
            const old = rec.entry
            rec.entry = entry
            if (entry.x !== old.x || entry.y !== old.y) {
              this.tweens.killTweensOf(rec.sprite)
              rec.direction = directionFromVelocity(px - rec.sprite.x, py - rec.sprite.y, rec.direction)
              rec.isMoving = true
              this.tweens.add({
                targets: rec.sprite,
                x: px, y: py,
                duration: ENTITY_MOVE_DURATION_MS,
                ease: 'Linear',
                onComplete: () => {
                  if (!rec.sprite.active) return
                  rec.isMoving = false
                  rec.animFrame = 0
                  rec.animTimer = 0
                  rec.sprite.setFrame(getFrame(rec.direction, 0))
                },
              })
            }
          } else {
            const textureKey = `NPCs/${entry.templateId}`
            const sprite = this.add.sprite(px, py, textureKey)
              .setFrame(getFrame('down', 0))
              .setDepth(9)
            this._remoteNpcs.set(id, {
              sprite,
              entry,
              direction: 'down',
              animFrame: 0,
              animTimer: 0,
              isMoving: false,
            })
          }
        }
      }

      for (const [id, rec] of this._remoteNpcs.entries()) {
        if (!incoming.has(id)) {
          this.tweens.killTweensOf(rec.sprite)
          rec.sprite.destroy()
          this._remoteNpcs.delete(id)
        }
      }
    })
  }

  /**
   * Top-level handler for the E key (attack / interact).
   * Checks the facing tile for an NPC first; if found, opens DialogScene.
   * Falls back to the enemy attack handler if no NPC is present.
   */
  private async _handleInteract(tx: number, ty: number, direction: Direction): Promise<void> {
    const facingOffset: Record<Direction, [number, number]> = {
      down:  [0, 1],
      up:    [0, -1],
      left:  [-1, 0],
      right: [1, 0],
    }
    const [fdx, fdy] = facingOffset[direction]

    // Check facing tile first, then remaining adjacent tiles for an NPC.
    // NPCs take priority over enemies and cannot be attacked.
    const adjacentOffsets: [number, number][] = [
      [fdx, fdy], [0, 1], [0, -1], [-1, 0], [1, 0],
    ]
    for (const [ox, oy] of adjacentOffsets) {
      const cx = tx + ox
      const cy = ty + oy
      for (const [id, rec] of this._remoteNpcs.entries()) {
        if (rec.entry.x === cx && rec.entry.y === cy) {
          this._openDialog(id, rec.entry.templateId, cx, cy)
          return
        }
      }
    }

    // PVP check — facing tile only, both players must be level 10+
    {
      const [fdxPvp, fdyPvp] = facingOffset[direction]
      const px = tx + fdxPvp
      const py = ty + fdyPvp
      const localLevel = getLocalPlayer().level ?? 0
      for (const [targetId, rec] of this._remotePlayers.entries()) {
        if (rec.entry.x === px && rec.entry.y === py) {
          if (localLevel >= 10 && (rec.entry.level ?? 0) >= 10) {
            void this._handlePvpAttack(targetId, rec.sprite)
          } else {
            this._showFloatText(px, py, 'PVP: level 10+ only', '#888888')
          }
          return
        }
      }
    }

    // Crafting station check — facing tile only (Step 11)
    const [fdx2, fdy2] = facingOffset[direction]
    const craftStation = this._getCraftStation(tx + fdx2, ty + fdy2)
    if (craftStation) {
      this._openCraft(craftStation)
      return
    }

    // Chest check — facing tile only (Step 13)
    if (this._handleChest(tx + fdx2, ty + fdy2)) return

    // Gathering check — facing tile only (Step 11)
    if (await this._handleGather(tx + fdx2, ty + fdy2)) return

    // No gatherable tile either — proceed with enemy attack (facing tile only)
    await this._handlePlayerAttack(tx, ty, direction)
  }

  /**
   * Freeze the player and launch DialogScene for the given NPC.
   * Re-subscribes an unfreeze listener each time so it fires exactly once.
   */
  private _openDialog(npcId: string, templateId: string, npcX: number, npcY: number): void {
    if (templateId.startsWith('merchant')) { this._openShop(npcId, npcX, npcY); return }
    this.playerController.freeze()
    const data: DialogSceneData = { templateId, npcX, npcY, npcId }
    this.scene.launch('DialogScene', data)
    this.scene.get('DialogScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  // ── Crafting (Step 11) ────────────────────────────────────────────────────

  /** Maps tile IDs to their crafting station type. */
  private static readonly _CRAFT_TILES: Record<string, CraftSceneData['station']> = {
    workbench:    'workbench',
    workshop:     'workshop',
    dungeon_altar: 'dungeon_altar',
  }

  /**
   * Return the crafting station type if the tile at (cx, cy) is a station,
   * otherwise null.
   */
  private _getCraftStation(cx: number, cy: number): CraftSceneData['station'] | null {
    const tile = getTile(cx, cy)
    if (!tile) return null
    for (const layerId of [tile.g, ...(tile.m ?? [])]) {
      const station = GameScene._CRAFT_TILES[layerId]
      if (station) return station
    }
    return null
  }

  /**
   * Freeze the player and launch CraftScene for the given station.
   */
  private _openCraft(station: CraftSceneData['station']): void {
    if (this.scene.isActive('CraftScene')) return
    this.playerController.freeze()
    const data: CraftSceneData = { station }
    this.scene.launch('CraftScene', data)
    this.scene.get('CraftScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  /**
   * Freeze the player and open the inventory/equipment overlay (Step 11).
   */
  private _openInventory(): void {
    this.playerController.freeze()
    this.scene.launch('InventoryScene')
    this.scene.get('InventoryScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  /** PVP attack: deals power damage to a remote player. Level 10+ gate enforced. */
  private async _handlePvpAttack(targetId: string, targetSprite: Phaser.GameObjects.Sprite): Promise<void> {
    const player = getLocalPlayer()
    const damage = Math.max(1, player.power)
    const snap   = await get(ref(db, `players/${targetId}/hp`))
    const curHp  = typeof snap.val() === 'number' ? (snap.val() as number) : 1
    const newHp  = Math.max(0, curHp - damage)
    void update(ref(db), { [`players/${targetId}/hp`]: newHp })
    const tx = Math.floor(targetSprite.x / TILE_SIZE)
    const ty = Math.floor(targetSprite.y / TILE_SIZE)
    this._showFloatText(tx, ty, `-${damage}`, '#ff8888')
  }

  /**
   * Freeze the player and open the merchant shop with zone-aware pricing (Step 14).
   * Derives villageId from the NPC id, then looks up the POI for zone + seed.
   */
  private _openShop(npcId: string, npcX: number, npcY: number): void {
    if (this.scene.isActive('ShopScene')) return

    let data: ShopSceneData = { villageId: 'unknown', zone: 'plains', villageSeed: 0 }
    try {
      const cfg       = getWorldConfig()
      // NPC id format: 'npc_{villageId}_merchant' → extract villageId
      const villageId = npcId.replace(/^npc_/, '').replace(/_merchant$/, '')
      const poi       = cfg.pois.villages.find(v => v.id === villageId)
      const zone      = getWorldZone(poi?.x ?? npcX, poi?.y ?? npcY)
      const villageSeed = poi ? cfg.seed ^ poi.x ^ poi.y : cfg.seed
      data = { villageId, zone, villageSeed }
    } catch { /* world config not ready — use safe defaults */ }

    this.playerController.freeze()
    this.scene.launch('ShopScene', data)
    this.scene.get('ShopScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  /**
   * Freeze the player and open the chest UI (storage or loot mode).
   * On close, invalidates all chest tile positions so death-loot removals render.
   */
  private _openChestUI(data: StorageSceneData): void {
    if (this.scene.isActive('StorageScene')) return
    this.playerController.freeze()
    this.scene.launch('StorageScene', data)
    this.scene.get('StorageScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => {
        this.playerController.unfreeze()
        const positions = data.chestList ?? [{ x: data.tileX, y: data.tileY }]
        for (const pos of positions) this.tilemapRenderer.invalidateTile(pos.x, pos.y)
      },
    )
  }

  // ── Gathering (Step 11) ────────────────────────────────────────────────────

  /**
   * Tool required per gather action (scythe covers cut; pick needs no tool).
   */
  private static readonly _GATHER_TOOL: Record<string, string> = {
    chop: 'axe',
    mine: 'pickaxe',
    cut:  'scythe',
  }

  /**
   * Try to gather the tile at world position (cx, cy).
   * Returns true if the tile was gatherable (even if blocked by cooldown / missing tool),
   * so the caller knows not to fall through to the attack handler.
   */
  private async _handleGather(cx: number, cy: number): Promise<boolean> {
    const tileData = getTile(cx, cy)
    if (!tileData) return false

    // Find the gatherable tile ID (middle layer first, then ground)
    let gatherTileId: string | null = null
    let gatherLayer: 'MIDDLE' | 'GROUND' = 'GROUND'

    for (const mid of (tileData.m ?? [])) {
      try {
        if (TileRegistry.get(mid).gatherAction) { gatherTileId = mid; gatherLayer = 'MIDDLE'; break }
      } catch { /* unknown tile — skip */ }
    }
    if (!gatherTileId) {
      try {
        if (TileRegistry.get(tileData.g).gatherAction) { gatherTileId = tileData.g; gatherLayer = 'GROUND' }
      } catch { /* skip */ }
    }
    if (!gatherTileId) return false  // tile is not gatherable

    const tileDef = TileRegistry.get(gatherTileId)

    // Cooldown check
    if (tileData.metadata?.regenAt && Date.now() < tileData.metadata.regenAt) {
      this._showFloatText(cx, cy, 'Not ready…', '#888888')
      return true
    }

    // Tool check
    const player  = getLocalPlayer()
    const toolId  = GameScene._GATHER_TOOL[tileDef.gatherAction ?? '']
    if (toolId) {
      const hasTool = (player.inventory ?? []).some(s => s.itemId === toolId)
        || player.equippedWeapon === toolId
      if (!hasTool) {
        const toolName = toolId.replace(/_/g, ' ')
        this._showFloatText(cx, cy, `Need a ${toolName}`, '#ff8844')
        return true
      }
    }

    this.sound.play('sfx_gather', { volume: 0.6 })

    // ── Multi-charge logic ──────────────────────────────────────────────────
    const maxCharges     = tileDef.gatherCharges ?? 1
    const currentCharges = tileData.metadata?.charges ?? maxCharges
    const newCharges     = currentCharges - 1

    // Roll drops for this hit
    const newInv  = [...(player.inventory ?? [])]
    let   newGold = player.gold ?? 0

    for (const drop of (tileDef.dropTable ?? [])) {
      if (Math.random() >= drop.chance) continue
      const qty = Math.floor(Math.random() * (drop.max - drop.min + 1)) + drop.min
      if (drop.itemId === 'gold_coin') {
        newGold += qty
        this._showFloatText(cx, cy, `+${qty} gold`, '#ffdd88')
      } else {
        const slot = newInv.find(s => s.itemId === drop.itemId)
        if (slot) slot.quantity += qty
        else newInv.push({ itemId: drop.itemId, quantity: qty, metadata: {} })
        const label = drop.itemId.replace(/_/g, ' ')
        this._showFloatText(cx, cy, `+${qty} ${label}`, '#88ffcc')
      }
    }

    player.inventory = newInv
    player.gold      = newGold
    setLocalPlayer(player)

    const room = getActiveRoom() ?? '0'

    let newTileData: import('../world/types.ts').TileData

    if (newCharges > 0) {
      // ── Partial gather: tile stays, only decrement charges ──────────────
      newTileData = {
        ...tileData,
        metadata: { ...(tileData.metadata ?? {}), charges: newCharges },
      }
    } else {
      // ── Final charge: deplete tile, record originalId for regen ─────────
      const regenAt    = tileDef.regenSeconds
        ? Date.now() + tileDef.regenSeconds * 1000
        : undefined
      const becomes    = tileDef.becomesOnGather ?? null
      const meta = {
        ...(tileData.metadata ?? {}),
        ...(regenAt ? { regenAt, originalId: gatherTileId, originalLayer: gatherLayer } : {}),
      }
      // Remove charge tracking now that the tile is depleted
      delete meta.charges

      if (gatherLayer === 'MIDDLE') {
        const newM = (tileData.m ?? []).filter(id => id !== gatherTileId)
        if (becomes) newM.push(becomes)
        newTileData = {
          g: tileData.g,
          ...(newM.length ? { m: newM } : {}),
          ...(tileData.t  ? { t: tileData.t } : {}),
          ...(regenAt     ? { metadata: meta }  : {}),
        }
      } else {
        newTileData = {
          g: becomes ?? tileData.g,
          ...(tileData.m ? { m: tileData.m } : {}),
          ...(tileData.t ? { t: tileData.t } : {}),
          ...(regenAt    ? { metadata: meta }  : {}),
        }
      }
    }

    // Update local cache and invalidate the rendered tile so it redraws next frame
    setTile(cx, cy, newTileData)
    this.tilemapRenderer.invalidateTile(cx, cy)

    // Persist to Firebase
    await update(ref(db), {
      [room === '0' ? overworldTilePath(cx, cy) : `map/${room}/${tileKey(cx, cy)}`]: newTileData,
      [`players/${player.id}/inventory`]:  newInv,
      [`players/${player.id}/gold`]:       newGold,
    })

    return true
  }

  /** Chest tile IDs recognised by the interact system. */
  private static readonly _CHEST_TILES = new Set(['chest', 'dungeon_chest', 'cellar_chest'])

  /**
   * Open a chest at (cx, cy) via the StorageScene UI.
   * Collects all chests in the current room to enable prev/next navigation.
   * Returns true if a chest tile was handled (so the caller skips attacking).
   */
  private _handleChest(cx: number, cy: number): boolean {
    const tile = getTile(cx, cy)
    if (!tile) return false
    if (![tile.g, ...(tile.m ?? [])].some(l => GameScene._CHEST_TILES.has(l))) return false

    const room       = getActiveRoom() ?? '0'
    const allInRoom  = findAllTilesInRoom(GameScene._CHEST_TILES)
    const chestList  = allInRoom.length ? allInRoom : [{ x: cx, y: cy }]
    const chestIndex = Math.max(0, chestList.findIndex(p => p.x === cx && p.y === cy))

    this._openChestUI({ tileX: cx, tileY: cy, roomId: room, chestList, chestIndex })
    return true
  }

  /**
   * Drop the player's entire inventory as a loot chest on their current tile
   * (called on death). Gold is kept, not dropped. The chest can be reopened with
   * E by anyone who returns to the spot.
   */
  private _dropInventoryAsLoot(room: string, inv: { itemId: string; quantity: number }[]): void {
    if (!inv.length) return
    const tx = Math.floor(this.playerController.px / TILE_SIZE)
    const ty = Math.floor(this.playerController.py / TILE_SIZE)
    const existing = getTile(tx, ty)
    if (!existing) return

    const items = inv.map(s => ({ itemId: s.itemId, quantity: s.quantity }))
    const newTile: import('../world/types.ts').TileData = {
      g: existing.g,
      m: [...(existing.m ?? []).filter(m => m !== 'chest'), 'chest'],
      ...(existing.t ? { t: existing.t } : {}),
      metadata: { ...(existing.metadata ?? {}), opened: false, dropped: true, items },
    }
    setTile(tx, ty, newTile)
    this.tilemapRenderer.invalidateTile(tx, ty)
    void update(ref(db), { [(room || '0') === '0' ? overworldTilePath(tx, ty) : `map/${room}/${tileKey(tx, ty)}`]: newTile })
  }

  /**
   * Show a short floating label above a tile position (same style as damage/regen floats).
   */
  private _showFloatText(tx: number, ty: number, text: string, color: string): void {
    const wx = tx * TILE_SIZE + TILE_SIZE / 2
    const wy = ty * TILE_SIZE
    const t  = this.add.text(wx, wy, text, {
      fontFamily: 'monospace', fontSize: '7px',
      color, stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(50)
    this.tweens.add({
      targets:  t,
      y:        wy - TILE_SIZE * 1.5,
      alpha:    0,
      duration: 1400,
      ease:     'Cubic.easeOut',
      onComplete: () => t.destroy(),
    })
  }

  /**
   * PVP: attempt to attack a remote player on tile (atx, aty). Allowed only when
   * both the attacker and the target are level 10+. Damage is applied via a
   * Firebase transaction on the target's hp; the target's own client detects the
   * drop (via HudScene's /players listener) and handles death/respawn.
   * Returns true if a player occupied the tile (so the caller stops here).
   */
  private _tryAttackPlayer(atx: number, aty: number): boolean {
    const attacker = getLocalPlayer()
    for (const [id, rec] of this._remotePlayers) {
      if (rec.entry.x !== atx || rec.entry.y !== aty) continue
      if (attacker.level < 10 || (rec.entry.level ?? 1) < 10) {
        this._showFloatText(atx, aty, 'PVP needs Lv.10', '#ff8844')
        return true
      }
      const dmg = Math.max(1, attacker.power)
      void runTransaction(
        ref(db, `players/${id}/hp`),
        (hp: number | null) => (hp == null ? undefined : Math.max(0, hp - dmg)),
      )
      rec.sprite.setTint(0xff4444)
      this.time.delayedCall(150, () => { if (rec.sprite.active) rec.sprite.clearTint() })
      this._showFloatText(atx, aty, `-${dmg}`, '#ff3333')
      return true
    }
    return false
  }

  /**
   * Handle an attack attempt from the local player.
   * Scans the 4 cardinal tiles for an enemy (facing direction first).
   * Deals damage, flashes the sprite red, kills the enemy on HP ≤ 0.
   */
  private async _handlePlayerAttack(tx: number, ty: number, direction: Direction): Promise<void> {
    // Only attack the single tile the player is facing
    const facingOffset: Record<Direction, [number, number]> = {
      down:  [0, 1],
      up:    [0, -1],
      left:  [-1, 0],
      right: [1, 0],
    }

    const [dx, dy] = facingOffset[direction]
    const atx = tx + dx
    const aty = ty + dy

    this.sound.play('sfx_swing', { volume: 0.7 })

    let targetId: string | null = null
    let targetEntry: EnemyPresenceEntry | null = null

    for (const [id, entry] of this._enemyData.entries()) {
      if (entry.x === atx && entry.y === aty) {
        targetId = id
        targetEntry = { ...entry }
        break
      }
    }

    if (!targetId || !targetEntry) {
      // No enemy on the facing tile — try PVP (same room, both level ≥ 10).
      this._tryAttackPlayer(atx, aty)
      return
    }

    const player = getLocalPlayer()
    const damage  = Math.max(1, player.power)
    // Use local HP as authoritative source — never reset by Firebase snapshots
    const currentHp = this._localEnemyHp.has(targetId)
      ? this._localEnemyHp.get(targetId)!
      : targetEntry.hp
    const newHp = currentHp - damage
    this._localEnemyHp.set(targetId, newHp)

    // Flash the enemy sprite red for 150 ms
    const enemyRec = this._remoteEnemies.get(targetId)
    if (enemyRec) {
      enemyRec.sprite.setTint(0xff4444)
      this.time.delayedCall(150, () => { if (enemyRec.sprite.active) enemyRec.sprite.clearTint() })
    }

    // Floating remaining-HP number
    const dmgText = this.add.text(
      targetEntry.x * TILE_SIZE + TILE_SIZE / 2,
      targetEntry.y * TILE_SIZE,
      `${Math.max(0, newHp)}`,
      { fontFamily: 'monospace', fontSize: '7px', color: '#ff3333', stroke: '#000000', strokeThickness: 2 },
    ).setOrigin(0.5, 1).setDepth(50)
    this.tweens.add({
      targets: dmgText,
      y:       dmgText.y - TILE_SIZE * 1.5,
      alpha:   0,
      duration: 1400,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    })

    const room = player.room

    if (newHp <= 0) {
      // ── Enemy death ────────────────────────────────────────────────────
      let template: import('../registry/types.ts').EnemyDefinition | null = null
      try { template = EnemyRegistry.get(targetEntry.templateId) } catch { /* unknown */ }

      const xpGain = template ? Math.max(1, Math.floor(template.baseHp / 5)) : 1

      // Roll loot table
      const newInventory = [...(player.inventory ?? [])]
      let newGold = player.gold ?? 0
      if (template) {
        for (const { itemId, min, max, chance } of template.lootTable) {
          if (Math.random() < chance) {
            const qty = Math.floor(Math.random() * (max - min + 1)) + min
            if (itemId === 'gold_coin') {
              newGold += qty
            } else {
              const slot = newInventory.find(s => s.itemId === itemId)
              if (slot) slot.quantity += qty
              else newInventory.push({ itemId, quantity: qty, metadata: {} })
            }
          }
        }
      }

      // Optimistically update local player
      player.xp        = player.xp + xpGain
      player.gold      = newGold
      player.inventory = newInventory

      // ── Level-up check ───────────────────────────────────────────────
      let levelsGained   = 0
      let totalHpGained  = 0
      let totalPwrGained = 0
      while (player.xp >= xpForLevel(player.level + 1)) {
        // Gains scale with the level being left behind so each step feels bigger.
        // maxHp: +11 at Lv2, +15 at Lv6, +20 at Lv11, +30 at Lv21
        // power: +1 normally, +1 extra every 5 levels (Lv5, 10, 15, 20 …)
        const hpGain  = 10 + player.level              // pre-increment level
        const pwrGain = 1 + Math.floor(player.level / 5)

        player.level  += 1
        player.maxHp  += hpGain
        player.hp      = Math.min(player.hp + hpGain, player.maxHp)
        player.power   += pwrGain

        totalHpGained  += hpGain
        totalPwrGained += pwrGain
        levelsGained++
      }

      setLocalPlayer(player)

      // Level-up banner — screen-space, shows exact gains
      if (levelsGained > 0) {
        const cx = this.cameras.main.width  / 2
        const cy = this.cameras.main.height / 2
        const gainLine = `+${totalHpGained} HP   +${totalPwrGained} Power`
        const lvText = this.add.text(
          cx, cy - 20,
          `✦ LEVEL UP!  Lv.${player.level} ✦\n${gainLine}`,
          {
            fontFamily: 'monospace', fontSize: '16px', color: '#ffff44',
            stroke: '#000000', strokeThickness: 3,
            align: 'center',
          },
        ).setOrigin(0.5).setScrollFactor(0).setDepth(200)
        this.tweens.add({
          targets:  lvText,
          y:        cy - 80,
          alpha:    0,
          duration: 2800,
          ease:     'Cubic.easeOut',
          onComplete: () => lvText.destroy(),
        })
      }

      // Remove from ScriptExecutor cache immediately so the next tick
      // doesn't re-create the entity in Firebase before the listener fires
      this._scriptExecutor.removeEnemy(targetId)

      // Atomic Firebase write
      await update(ref(db), {
        [`presence/${room}/enemies/${targetId}`]:  null,
        [`entities/enemies/${targetId}`]:          null,  // remove from ScriptExecutor's feed
        [`players/${player.id}/xp`]:               player.xp,
        [`players/${player.id}/gold`]:             newGold,
        [`players/${player.id}/inventory`]:        newInventory,
        ...(levelsGained > 0 && {
          [`players/${player.id}/level`]:  player.level,
          [`players/${player.id}/maxHp`]:  player.maxHp,
          [`players/${player.id}/hp`]:     player.hp,
          [`players/${player.id}/power`]:  player.power,
        }),
      })
    } else {
      // ── Damage only ────────────────────────────────────────────────────
      await update(ref(db), {
        [`presence/${room}/enemies/${targetId}/hp`]: newHp,
        [`entities/enemies/${targetId}/hp`]:        newHp,
      })
    }
  }
}
