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
import { ref, onValue, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { TilemapRenderer, TILE_SIZE, isTileRoomExit, TILE_DEFS } from '../renderer/TilemapRenderer.ts'
import type { Direction } from '../renderer/SpriteAnim.ts'
import { ANIM_FRAMES, FRAME_DURATION_MS, directionFromVelocity, getFrame } from '../renderer/SpriteAnim.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { enterRoom, exitRoom, findTileInRoom, getTile, setTile, getActiveRoom } from '../world/ChunkManager.ts'
import { HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { CELLAR_ROOM_SIZE } from '../world/CellarGen.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { remotePlayerTiles, remoteEnemyTiles, isPassable } from '../world/CollisionMap.ts'
import { xpForLevel, tileKey } from '../world/utils.ts'
import { EnemyRegistry, TileRegistry } from '../registry/registries.ts'
import { ScriptExecutor } from '../world/ScriptExecutor.ts'
import type { NearbyPlayer } from '../world/ScriptExecutor.ts'
import type { DialogSceneData } from './DialogScene.ts'

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

  /** True while the death/respawn sequence is in progress. */
  private _isDead = false
  /** The DOM death overlay element, if currently shown. */
  private _deathOverlay: HTMLDivElement | null = null
  /** performance.now() timestamp of the last time enemy damage landed. Used for the invincibility window. */
  private _lastDamageAt = 0
  /** Minimum milliseconds between consecutive enemy hits (invincibility window). */
  private static readonly _INVINCIBILITY_MS = 600

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
      const cam = this.cameras.main
      const step = dy > 0 ? -1 : 1
      const newZoom = Phaser.Math.Clamp(cam.zoom + step, 1, 4)
      cam.setZoom(newZoom)
      localStorage.setItem('rpidigo.zoom', String(newZoom))
    })

    const savedZoom = parseInt(localStorage.getItem('rpidigo.zoom') ?? '1', 10)
    this.cameras.main.setZoom(Phaser.Math.Clamp(savedZoom, 1, 3))

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

    // Subscribe to the overworld presence room on startup
    this._subscribePresence(getLocalPlayer().room)

    // Clean up Firebase listeners when the scene shuts down
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this._presenceUnsub) { this._presenceUnsub(); this._presenceUnsub = null }
      if (this._enemyUnsub)    { this._enemyUnsub();    this._enemyUnsub    = null }
      if (this._npcUnsub)      { this._npcUnsub();      this._npcUnsub      = null }
      this._scriptExecutor.destroy()
      this._deathOverlay?.remove()
      this._deathOverlay = null
    })
  }

  update(_time: number, delta: number): void {
    this.playerController.update(delta)

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
    this._scriptExecutor.tick(tx, ty, this._buildNearbyPlayers(), (targetPlayerId, damage) => {
      // Only apply damage to the local player
      if (targetPlayerId === getLocalPlayer().id) {
        this._applyEnemyDamage(damage)
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
  private _applyEnemyDamage(rawDamage: number): void {
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
   * Trigger the death sequence: freeze input, show overlay, auto-respawn after 3 s.
   */
  private _triggerDeath(): void {
    if (this._isDead) return
    this._isDead = true
    this.playerController.freeze()

    const player = getLocalPlayer()
    player.hp = 0
    setLocalPlayer(player)
    void update(ref(db), { [`players/${player.id}/hp`]: 0 })

    const overlay = document.createElement('div')
    overlay.id = 'death-overlay'
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'z-index:1000', 'color:#ff4444', 'font-family:monospace', 'user-select:none',
    ].join(';')
    overlay.innerHTML = [
      '<div style="font-size:36px;letter-spacing:6px;text-shadow:0 0 20px #f00">YOU DIED</div>',
      '<div style="font-size:12px;color:#aaa;margin-top:14px">Respawning at your house in 3 seconds...</div>',
    ].join('')
    document.body.appendChild(overlay)
    this._deathOverlay = overlay

    this.time.delayedCall(3000, () => this._respawn())
  }

  /**
   * Respawn: restore HP, teleport to player house, exit any active room, re-enable input.
   */
  private _respawn(): void {
    this._deathOverlay?.remove()
    this._deathOverlay = null
    this._isDead = false

    const player = getLocalPlayer()
    const oldRoom = player.room
    const hx = player.house?.x ?? player.x
    const hy = player.house?.y ?? player.y

    player.hp   = player.maxHp
    player.room = '0'
    player.x    = hx
    player.y    = hy
    setLocalPlayer(player)

    // Exit room if the player died inside one
    if (oldRoom !== '0') {
      exitRoom()
      this.tilemapRenderer.reset()
      this.cameras.main.setBounds(0, 0, WORLD_PIXEL_SIZE, WORLD_PIXEL_SIZE)
      this.playerController.startCameraFollow()
    }

    this.playerController.teleport(hx, hy)
    this._subscribePresence('0')

    const respawnUpdate: Record<string, unknown> = {
      [`players/${player.id}/hp`]:   player.maxHp,
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
    // Only null the old-room presence entry when it's a different room;
    // setting a parent to null AND its children in the same update() is invalid.
    if (oldRoom !== '0') {
      respawnUpdate[`presence/${oldRoom}/players/${player.id}`] = null
    }
    void update(ref(db), respawnUpdate)

    this.playerController.unfreeze()
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

    // No adjacent NPC — check facing tile for gathering (Step 11)
    const [fdx2, fdy2] = facingOffset[direction]
    if (await this._handleGather(tx + fdx2, ty + fdy2)) return

    // No gatherable tile either — proceed with enemy attack (facing tile only)
    await this._handlePlayerAttack(tx, ty, direction)
  }

  /**
   * Freeze the player and launch DialogScene for the given NPC.
   * Re-subscribes an unfreeze listener each time so it fires exactly once.
   */
  private _openDialog(npcId: string, templateId: string, npcX: number, npcY: number): void {
    void npcId  // reserved for future per-NPC state (e.g. quest tracking)
    this.playerController.freeze()
    const data: DialogSceneData = { templateId, npcX, npcY }
    this.scene.launch('DialogScene', data)
    // Unfreeze exactly once when DialogScene shuts down
    this.scene.get('DialogScene').events.once(
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

    // Roll drops
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

    // Build updated tile data
    const regenAt = tileDef.regenSeconds
      ? Date.now() + tileDef.regenSeconds * 1000
      : undefined
    const becomes  = tileDef.becomesOnGather ?? null
    const becomesLayer = becomes ? (TILE_DEFS[becomes]?.layer ?? 'GROUND') : 'GROUND'

    let newTileData: import('../world/types.ts').TileData
    if (gatherLayer === 'MIDDLE') {
      const newM = (tileData.m ?? []).filter(id => id !== gatherTileId)
      if (becomes && becomesLayer === 'MIDDLE') newM.push(becomes)
      newTileData = {
        g: tileData.g,
        ...(newM.length ? { m: newM } : {}),
        ...(tileData.t  ? { t: tileData.t } : {}),
        ...(regenAt ? { metadata: { ...tileData.metadata, regenAt } } : {}),
      }
    } else {
      newTileData = {
        g: becomes ?? tileData.g,
        ...(tileData.m ? { m: tileData.m } : {}),
        ...(tileData.t ? { t: tileData.t } : {}),
        ...(regenAt ? { metadata: { ...tileData.metadata, regenAt } } : {}),
      }
    }

    // Update local cache immediately (renderer + collision pick it up next frame)
    setTile(cx, cy, newTileData)

    // Persist to Firebase
    const room = getActiveRoom() ?? '0'
    await update(ref(db), {
      [`map/${room}/${tileKey(cx, cy)}`]:  newTileData,
      [`players/${player.id}/inventory`]:  newInv,
      [`players/${player.id}/gold`]:       newGold,
    })

    return true
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

    let targetId: string | null = null
    let targetEntry: EnemyPresenceEntry | null = null

    for (const [id, entry] of this._enemyData.entries()) {
      if (entry.x === atx && entry.y === aty) {
        targetId = id
        targetEntry = { ...entry }
        break
      }
    }

    if (!targetId || !targetEntry) return

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
