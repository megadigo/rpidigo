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
import { ANIM_FRAMES, FRAME_DURATION_MS, directionFromVelocity, getFrame, getAttackFrame } from '../renderer/SpriteAnim.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { enterRoom, exitRoom, findTileInRoom, findAllTilesInRoom, getTile, setTile, getActiveRoom, getWorldZone, ensureRadius, tileToChunk, overworldTilePath } from '../world/ChunkManager.ts'
import { getWorldConfig } from '../world/WorldBootstrap.ts'
import { setRoomLocked } from '../world/RoomState.ts'
import { HOUSE_ROOM_SIZE, houseRoomId } from '../world/HouseGen.ts'
import { CELLAR_ROOM_SIZE } from '../world/CellarGen.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { remotePlayerTiles, remoteEnemyTiles, isPassable } from '../world/CollisionMap.ts'
import { xpForLevel, tileKey } from '../world/utils.ts'
import { EnemyRegistry, TileRegistry, ItemRegistry, WeaponRegistry } from '../registry/registries.ts'
import { rollAttackDamage, findNewUnlocks } from '../world/playerStats.ts'
import { ProjectileSystem } from '../world/ProjectileSystem.ts'
import type { ProjectileHitEvent, EnemyTarget } from '../world/ProjectileSystem.ts'
import { ScriptExecutor } from '../world/ScriptExecutor.ts'
import type { NearbyPlayer } from '../world/ScriptExecutor.ts'
import type { DialogSceneData } from './DialogScene.ts'
import type { CraftSceneData } from './CraftScene.ts'
import type { ShopSceneData } from './ShopScene.ts'
import type { StorageSceneData } from './StorageScene.ts'
import type { DeathSceneData } from './DeathScene.ts'
import type { LevelUpSceneData } from './LevelUpScene.ts'
import { MusicDirector } from '../audio/MusicDirector.ts'
import { checkAndAdvanceQuestsLocally } from '../world/questUtils.ts'
import patrolAggressive from '../scripts/enemies/patrol_aggressive.py?raw'

/** Tile bounds of the 1000×1000 overworld in pixels. */
const WORLD_PIXEL_SIZE = 1000 * TILE_SIZE
const ENTITY_MOVE_DURATION_MS = 180
/** How long (ms) to play the attack animation after an enemy attacks. */
const ATTACK_ANIM_MS = 500

/** DOM-overlay scenes that own input (and Esc) while active — block taps and the pause menu. */
const PAUSE_BLOCKING_SCENES = ['DialogScene', 'InventoryScene', 'CraftScene',
  'ShopScene', 'StorageScene', 'DeathScene', 'PauseScene', 'LevelUpScene', 'StatsScene', 'QuestScene']

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
  facing?: Direction
  attackedAt?: number
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
  isAttacking: boolean
  attackTimer: number
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
  /** On-screen arrow pointing toward the player's death-drop loot, shown while it's unretrieved and in-room. */
  private _lootArrow:    Phaser.GameObjects.Container | null = null
  private _lootArrowTip: Phaser.GameObjects.Graphics  | null = null
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

  /** Projectile system for ranged and magic attacks (Step 20). */
  private _projectileSystem!: ProjectileSystem

  /** Tracks how much local-player gold each enemy has stolen and can still lose on escape. */
  private _stolenByEnemy = new Map<string, number>()

  /** Accumulated delta (ms) since the last regen tick. Reset whenever the player takes damage. */
  private _healTimer = 0
  /** Milliseconds the player must be out of combat before regen starts ticking. */
  private static readonly _HEAL_OOC_DELAY_MS = 5_000
  /** Milliseconds between regen ticks once out of combat. */
  private static readonly _HEAL_INTERVAL_MS  = 5_000

  /** Tile distance accumulated locally since the last Firebase flush. */
  private _distAccum     = 0
  /** Timer (ms) counting toward the next distanceTraveled flush. */
  private _distFlushTimer = 0
  /** Last known tile X used for distance delta. */
  private _prevTileX     = -1
  /** Last known tile Y used for distance delta. */
  private _prevTileY     = -1

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    this.tilemapRenderer = new TilemapRenderer(this)
    this.playerController = new PlayerController(this)
    this.playerController.create()
    this._projectileSystem = new ProjectileSystem(this)

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

    // S key — open the character stats overlay (Step 21)
    const sKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S)
    if (sKey) {
      sKey.on('down', () => {
        if (this._isDead) return
        if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
        this._openStats()
      })
    }

    // On-screen inventory button emitted by HudScene
    this.game.events.on('openInventory', () => {
      if (this._isDead) return
      if (this.scene.isActive('DialogScene') || this.scene.isActive('InventoryScene')) return
      this._openInventory()
    })

    // Esc key — open the pause menu (Step 24); other overlays own Esc while active
    const escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
    if (escKey) {
      escKey.on('down', () => {
        if (this._isDead) return
        if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
        this._openPause()
      })
    }

    // On-screen menu button emitted by HudScene
    this.game.events.on('openPause', () => {
      if (this._isDead) return
      if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
      this._openPause()
    })

    // Q key — open quest log (Step 24)
    const qKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q)
    if (qKey) {
      qKey.on('down', () => {
        if (this._isDead) return
        if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
        this._openQuests()
      })
    }

    // On-screen quest button emitted by HudScene
    this.game.events.on('openQuests', () => {
      if (this._isDead) return
      if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
      this._openQuests()
    })

    // Quest reward level-up — emitted by overlay scenes (CraftScene, etc.) that
    // can't launch LevelUpScene directly without breaking the scene stack.
    this.game.events.on('questLevelUp', (data: { newLevel: number; levelBefore: number; statPointsGranted: number }) => {
      if (this.scene.isActive('LevelUpScene')) return
      const luData: LevelUpSceneData = {
        newLevel:      data.newLevel,
        pointsGranted: data.statPointsGranted,
        unlocks:       findNewUnlocks(data.levelBefore, data.newLevel),
      }
      this.playerController.freeze()
      this.scene.launch('LevelUpScene', luData)
      this.scene.get('LevelUpScene').events.once(
        Phaser.Scenes.Events.SHUTDOWN,
        () => this.playerController.unfreeze(),
      )
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
        if (PAUSE_BLOCKING_SCENES.some(s => this.scene.isActive(s))) return
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
      this._projectileSystem.destroyAll()
      if (this.scene.isActive('DeathScene')) this.scene.stop('DeathScene')
      this.game.events.off('openInventory')
      this.game.events.off('openPause')
      this.game.events.off('openQuests')
      this.game.events.off('questLevelUp')
      this._flushDistanceTraveled()
    })
  }

  update(_time: number, delta: number): void {
    this.playerController.update(delta)

    // Death may be triggered by remote damage (PVP or another client) — the
    // shared local player object is kept current by HudScene's /players listener.
    if (!this._isDead && getLocalPlayer().hp <= 0) {
      this._triggerDeath()
    }

    this._updateLootArrow()

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

    // ── Distance traveled counter ──────────────────────────────────────────
    if (!this._isDead) {
      if (this._prevTileX >= 0 && (tx !== this._prevTileX || ty !== this._prevTileY)) {
        this._distAccum += Math.abs(tx - this._prevTileX) + Math.abs(ty - this._prevTileY)
      }
      this._prevTileX = tx
      this._prevTileY = ty
      this._distFlushTimer += delta
      if (this._distFlushTimer >= 30_000 && this._distAccum > 0) {
        this._distFlushTimer = 0
        this._flushDistanceTraveled()
      }
    }

    this._scriptExecutor.tick(tx, ty, this._buildNearbyPlayers(), (attackerId, targetPlayerId, damage, killerTemplateId) => {
      if (targetPlayerId === getLocalPlayer().id) {
        this._applyEnemyDamage(attackerId, damage, killerTemplateId)
      }
    })

    this._processEscapedGoldThieves(tx, ty)

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

    // Advance projectiles and resolve hits (Step 20)
    const enemyTargets: EnemyTarget[] = []
    for (const [id, entry] of this._enemyData) enemyTargets.push({ id, x: entry.x, y: entry.y })
    this._projectileSystem.update(delta, enemyTargets, (evt) => { void this._handleProjectileHit(evt) })

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
    if (rec.isAttacking) {
      rec.attackTimer -= delta
      if (rec.attackTimer <= 0) {
        rec.isAttacking = false
        rec.attackTimer = 0
        rec.animFrame = 0
        rec.animTimer = 0
        rec.sprite.setFrame(getFrame(rec.direction, 0))
        return
      }
      rec.animTimer += delta
      while (rec.animTimer >= FRAME_DURATION_MS) {
        rec.animTimer -= FRAME_DURATION_MS
        rec.animFrame = (rec.animFrame + 1) % ANIM_FRAMES
      }
      rec.sprite.setFrame(getAttackFrame(rec.direction, rec.animFrame))
      return
    }
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
  private _applyEnemyDamage(attackerEnemyId: string, rawDamage: number, killerTemplateId?: string): void {
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

    void this._maybeStealGold(attackerEnemyId)

    if (killerTemplateId) {
      try { this._lastKillerName = EnemyRegistry.get(killerTemplateId).displayName }
      catch { this._lastKillerName = killerTemplateId.replace(/_/g, ' ') }
    }
    if (newHp <= 0) this._triggerDeath()
  }

  /**
   * Gold-steal resolution (Step 22): on a successful enemy hit, transfer gold
   * from the local player to the enemy's carriedGold pool and broadcast a
   * system chat notification.
   */
  private async _maybeStealGold(attackerEnemyId: string): Promise<void> {
    const entry = this._enemyData.get(attackerEnemyId)
    if (!entry) return

    let def: import('../registry/types.ts').EnemyDefinition
    try { def = EnemyRegistry.get(entry.templateId) } catch { return }
    if (!def.stealGold) return

    const player = getLocalPlayer()
    const currentGold = player.gold ?? 0
    if (currentGold <= 0) return

    const [minSteal, maxSteal] = def.stealGold
    const rolled = minSteal + Math.floor(Math.random() * (maxSteal - minSteal + 1))
    const stealAmount = Math.max(0, Math.min(rolled, currentGold))
    if (stealAmount <= 0) return

    const enemyPath = `entities/enemies/${attackerEnemyId}`
    const enemySnap = await get(ref(db, enemyPath))
    const enemyVal = enemySnap.val() as { carriedGold?: number; memory?: Record<string, unknown> } | null
    if (!enemyVal) return

    // Thieves steal only once, then immediately flee.
    if (entry.templateId === 'thief_weak' && enemyVal.memory?.stoleGoldOnce === true) {
      return
    }

    const newGold = currentGold - stealAmount
    player.gold = newGold
    setLocalPlayer(player)

    this._stolenByEnemy.set(attackerEnemyId, (this._stolenByEnemy.get(attackerEnemyId) ?? 0) + stealAmount)

    const room = player.room
    const now = Date.now()
    const isThief = entry.templateId === 'thief_weak'
    await update(ref(db), {
      [`players/${player.id}/gold`]: newGold,
      [`${enemyPath}/carriedGold`]: (enemyVal.carriedGold ?? 0) + stealAmount,
      ...(isThief && {
        [`${enemyPath}/state`]: 'fleeing',
        [`${enemyPath}/memory/stoleGoldOnce`]: true,
        [`presence/${room}/enemies/${attackerEnemyId}/state`]: 'fleeing',
      }),
      [`chat/${room}/_steal_${attackerEnemyId}_${now}`]: {
        sender: 'System',
        x: entry.x,
        y: entry.y,
        text: `${def.displayName} stole ${stealAmount} gold from you!`,
        timestamp: now,
        system: true,
      },
    })

    this._showFloatText(entry.x, entry.y, `-${stealAmount} gold`, '#ffbb66')
  }

  /**
   * If a fleeing thief escapes beyond 30 tiles, their stolen local gold is
   * removed permanently from the enemy carriedGold pool.
   */
  private _processEscapedGoldThieves(playerTx: number, playerTy: number): void {
    for (const [enemyId, localStolen] of this._stolenByEnemy.entries()) {
      if (localStolen <= 0) {
        this._stolenByEnemy.delete(enemyId)
        continue
      }
      const entry = this._enemyData.get(enemyId)
      if (!entry) {
        this._stolenByEnemy.delete(enemyId)
        continue
      }
      if (entry.state !== 'fleeing') continue

      const dist = Math.max(Math.abs(entry.x - playerTx), Math.abs(entry.y - playerTy))
      if (dist <= 30) continue

      this._stolenByEnemy.delete(enemyId)
      const room = getLocalPlayer().room
      const now = Date.now()
      void update(ref(db), {
        [`chat/${room}/_stolen_lost_${enemyId}_${now}`]: {
          sender: 'System',
          x: entry.x,
          y: entry.y,
          text: `The fleeing ${entry.templateId.replace(/_/g, ' ')} escaped. Stolen gold is lost.`,
          timestamp: now,
          system: true,
        },
      })
      void runTransaction(ref(db, `entities/enemies/${enemyId}/carriedGold`), (val: number | null) => {
        const current = typeof val === 'number' ? val : 0
        return Math.max(0, current - localStolen)
      })
    }
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
    player.lastDeathLoot = this._deathItemsDropped > 0
      ? { room: this._deathRoom, x: this._deathTx, y: this._deathTy }
      : null
    setLocalPlayer(player)

    // ── Deaths counter ────────────────────────────────────────────────────────
    const pc = player.progressCounters ??= {}
    pc.deaths = (pc.deaths ?? 0) + 1
    setLocalPlayer(player)
    const questResult = checkAndAdvanceQuestsLocally(player)

    void update(ref(db), {
      [`players/${player.id}/hp`]:        0,
      [`players/${player.id}/inventory`]: keptItems,
      [`players/${player.id}/lastDeathLoot`]: player.lastDeathLoot,
      [`players/${player.id}/progressCounters/deaths`]: pc.deaths,
      ...questResult.updates,
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
   * Keep an on-screen arrow pointing toward the player's death-drop loot chest
   * while it remains unretrieved and the player is in the same room as it.
   * Hidden once the player is close enough to see the chest themselves.
   */
  private _updateLootArrow(): void {
    const player = getLocalPlayer()
    const target  = player.lastDeathLoot
    if (this._isDead || !target || target.room !== player.room) {
      if (this._lootArrow) { this._lootArrow.destroy(); this._lootArrow = null; this._lootArrowTip = null }
      return
    }

    const px = this.playerController.px
    const py = this.playerController.py
    const tx = target.x * TILE_SIZE + TILE_SIZE / 2
    const ty = target.y * TILE_SIZE + TILE_SIZE / 2
    const dx = tx - px
    const dy = ty - py
    const dist = Math.hypot(dx, dy)

    if (dist < TILE_SIZE * 2) {
      this._clearLootHint()
      return
    }

    if (!this._lootArrow || !this._lootArrowTip) this._createLootArrow()

    const angle = Math.atan2(dy, dx)
    const cam    = this.cameras.main
    const cx     = cam.width / 2
    const cy     = cam.height / 2
    const radius = Math.min(cam.width, cam.height) / 2 - 48
    this._lootArrow!.setPosition(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    this._lootArrowTip!.setRotation(angle)
  }

  /** Build the gold compass-arrow container shown by `_updateLootArrow`. */
  private _createLootArrow(): void {
    const tip = this.add.graphics()
    tip.fillStyle(0xffdd44, 0.95)
    tip.lineStyle(1, 0x553300, 1)
    tip.beginPath()
    tip.moveTo(8, 0)
    tip.lineTo(-5, -5)
    tip.lineTo(-5, 5)
    tip.closePath()
    tip.fillPath()
    tip.strokePath()

    const label = this.add.text(0, 10, 'loot', { fontFamily: 'monospace', fontSize: '7px', color: '#ffdd44' })
      .setOrigin(0.5, 0)

    const container = this.add.container(0, 0, [tip, label])
    container.setScrollFactor(0)
    container.setDepth(10_000)
    this._lootArrow    = container
    this._lootArrowTip = tip
  }

  /** Clear the death-loot hint once the player retrieves their belongings (or gets close enough to see the chest). */
  private _clearLootHint(): void {
    if (this._lootArrow) { this._lootArrow.destroy(); this._lootArrow = null; this._lootArrowTip = null }
    const player = getLocalPlayer()
    if (player.lastDeathLoot) {
      player.lastDeathLoot = null
      setLocalPlayer(player)
      void update(ref(db), { [`players/${player.id}/lastDeathLoot`]: null })
    }
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

    // ── Room-entry counters ───────────────────────────────────────────────────
    {
      const pc = player.progressCounters ??= {}
      const counterUpdate: Record<string, unknown> = {}
      if (roomId === houseRoomId(player.house.x, player.house.y)) {
        pc.houseEntered = (pc.houseEntered ?? 0) + 1
        counterUpdate[`players/${player.id}/progressCounters/houseEntered`] = pc.houseEntered
      } else if (roomId.startsWith('dungeon_')) {
        pc.dungeonsVisited = (pc.dungeonsVisited ?? 0) + 1
        counterUpdate[`players/${player.id}/progressCounters/dungeonsVisited`] = pc.dungeonsVisited
      }
      if (Object.keys(counterUpdate).length) {
        setLocalPlayer(player)
        const questResult = checkAndAdvanceQuestsLocally(player)
        void update(ref(db), { ...counterUpdate, ...questResult.updates })
      }
    }

    this._projectileSystem.destroyAll()
    await enterRoom(roomId)
    this.tilemapRenderer.reset()
    const { x: spawnX, y: spawnY } = this._spawnNextTo(spawnNear)
    this.playerController.teleport(spawnX, spawnY)

    // The presence entry written by PlayerController used a placeholder spawn
    // position (it doesn't know the room layout yet); correct it now so other
    // players immediately see this player at the actual spawn tile.
    void update(ref(db), {
      [`presence/${roomId}/players/${player.id}/x`]: spawnX,
      [`presence/${roomId}/players/${player.id}/y`]: spawnY,
    })

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
    this._projectileSystem.destroyAll()

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
    this._stolenByEnemy.clear()
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
            // Trigger attack animation when the server signals a new attack
            if (entry.attackedAt != null && entry.attackedAt !== old.attackedAt) {
              rec.isAttacking = true
              rec.attackTimer = ATTACK_ANIM_MS
              rec.animFrame = 0
              rec.animTimer = 0
            }
            // Update facing toward player when stationary
            if (entry.facing && !rec.isMoving) {
              rec.direction = entry.facing
            }
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
              isAttacking: false,
              attackTimer: 0,
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
              isAttacking: false,
              attackTimer: 0,
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

    // Tombstone smash — spawns a skeleton horde
    if (this._handleTombstone(tx + fdx2, ty + fdy2)) return

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

  /**
   * Freeze the player and open the pause menu overlay (Step 24).
   * Resume unfreezes normally; Log Out stops GameScene/HudScene itself, in
   * which case the SHUTDOWN handler below simply unfreezes a discarded controller.
   */
  private _openPause(): void {
    this.playerController.freeze()
    this.scene.launch('PauseScene')
    this.scene.get('PauseScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  /**
   * Freeze the player and open the character stats overlay (Step 21).
   * Lets the player view derived combat numbers, spend banked stat points,
   * or log out — same teardown pattern as the other DOM overlays.
   */
  private _openStats(): void {
    this.playerController.freeze()
    this.scene.launch('StatsScene')
    this.scene.get('StatsScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }

  /** PVP attack: deals power damage to a remote player. Level 10+ gate enforced. */
  private async _handlePvpAttack(targetId: string, targetSprite: Phaser.GameObjects.Sprite): Promise<void> {
    const player = getLocalPlayer()
    const { damage, crit } = rollAttackDamage(player)
    const snap   = await get(ref(db, `players/${targetId}/hp`))
    const curHp  = typeof snap.val() === 'number' ? (snap.val() as number) : 1
    const newHp  = Math.max(0, curHp - damage)
    void update(ref(db), { [`players/${targetId}/hp`]: newHp })
    const tx = Math.floor(targetSprite.x / TILE_SIZE)
    const ty = Math.floor(targetSprite.y / TILE_SIZE)
    this._showFloatText(tx, ty, crit ? `CRIT! -${damage}` : `-${damage}`, crit ? '#ffaa33' : '#ff8888')
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

  private static readonly _TOMBSTONE_IDS = new Set(['tombstone', 'dungeon_tombstones'])

  /**
   * If the tile at (cx, cy) contains a tombstone, smash it and spawn a horde of
   * aggressive skeletons nearby. Returns true when handled so the caller skips
   * the gather and attack fallbacks.
   */
  private _handleTombstone(cx: number, cy: number): boolean {
    const tile = getTile(cx, cy)
    if (!tile) return false
    if (![tile.g, ...(tile.m ?? [])].some(l => GameScene._TOMBSTONE_IDS.has(l))) return false

    // Remove tombstone from tile layers
    const newM = (tile.m ?? []).filter(l => !GameScene._TOMBSTONE_IDS.has(l))
    const newG = GameScene._TOMBSTONE_IDS.has(tile.g) ? 'grass' : tile.g
    const newTile: import('../world/types.ts').TileData = { ...tile, g: newG, m: newM }
    setTile(cx, cy, newTile)
    this.tilemapRenderer.invalidateTile(cx, cy)

    const room = getActiveRoom() ?? '0'
    void update(ref(db), {
      [room === '0' ? overworldTilePath(cx, cy) : `map/${room}/${tileKey(cx, cy)}`]: newTile,
    })

    this.sound.play('sfx_swing', { volume: 1.2 })
    this._showFloatText(cx, cy, 'The dead awaken!', '#aa44ff')
    this._spawnSkeletonHorde(cx, cy, room)
    return true
  }

  /** Spawn 3–5 aggressive skeletons on passable tiles around (tombX, tombY). */
  private _spawnSkeletonHorde(tombX: number, tombY: number, room: string): void {
    const def = EnemyRegistry.get('skeleton_weak')
    const count = 3 + Math.floor(Math.random() * 3) // 3–5

    // Collect passable tiles within a 2-tile radius
    const candidates: Array<{ x: number; y: number }> = []
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue
        const sx = tombX + dx, sy = tombY + dy
        if (isPassable(sx, sy)) candidates.push({ x: sx, y: sy })
      }
    }

    const now = Date.now()
    const fbUpdate: Record<string, unknown> = {}

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const { x, y } = candidates[i]
      const id = `enemy_tomb_${tombX}_${tombY}_${now}_${i}`
      const enemy: import('../world/types.ts').EnemyInstance = {
        id, templateId: 'skeleton_weak', baseType: 'skeleton', variant: 'weak',
        hp: def.baseHp, maxHp: def.baseHp, mp: 0, maxMp: 0, power: def.basePower,
        room, x, y, spawnRoom: room, spawnX: x, spawnY: y,
        state: 'charging',
        executingPlayerId: null, lastLogicAt: 0,
        script: patrolAggressive,
        memory: {},
        carriedGold: 0,
      }
      fbUpdate[`entities/enemies/${id}`] = enemy
      fbUpdate[`presence/${room}/enemies/${id}`] = {
        x, y, templateId: 'skeleton_weak', state: 'charging', hp: def.baseHp,
      }
    }

    if (Object.keys(fbUpdate).length) void update(ref(db), fbUpdate)
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
    const itemsGained: Record<string, number> = {}

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
        itemsGained[drop.itemId] = (itemsGained[drop.itemId] ?? 0) + qty
        const label = drop.itemId.replace(/_/g, ' ')
        this._showFloatText(cx, cy, `+${qty} ${label}`, '#88ffcc')
      }
    }

    player.inventory = newInv
    player.gold      = newGold

    // ── Progress counters & quest advancement ───────────────────────────────
    const pc = player.progressCounters ??= {}
    if (Object.keys(itemsGained).length > 0) {
      const cbi = pc.collectedByItemId ??= {}
      for (const [itemId, gained] of Object.entries(itemsGained)) {
        cbi[itemId] = (cbi[itemId] ?? 0) + gained
      }
    }
    setLocalPlayer(player)
    const questResult = checkAndAdvanceQuestsLocally(player)
    for (const title of questResult.completedTitles) {
      this._showFloatText(cx, cy, `Quest: ${title}`, '#ffdd44')
    }

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
      ...(pc.collectedByItemId && {
        [`players/${player.id}/progressCounters/collectedByItemId`]: pc.collectedByItemId,
      }),
      ...questResult.updates,
    })

    // Quest reward level-up
    if (questResult.levelsGained > 0) {
      const luData: LevelUpSceneData = {
        newLevel:      player.level,
        pointsGranted: questResult.statPointsGranted,
        unlocks:       findNewUnlocks(questResult.levelBefore, player.level),
      }
      if (!this.scene.isActive('LevelUpScene')) {
        this.playerController.freeze()
        this.scene.launch('LevelUpScene', luData)
        this.scene.get('LevelUpScene').events.once(
          Phaser.Scenes.Events.SHUTDOWN,
          () => this.playerController.unfreeze(),
        )
      }
    }

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

    const room = getActiveRoom() ?? '0'
    const loot = getLocalPlayer().lastDeathLoot
    if (loot && loot.room === room && loot.x === cx && loot.y === cy) this._clearLootHint()

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

  /** Drop carried enemy gold into a loot chest at the enemy death tile. */
  private _dropEnemyCarriedGold(room: string, tx: number, ty: number, gold: number): void {
    if (gold <= 0) return
    const existing = getTile(tx, ty)
    if (!existing) return

    const layers = [existing.g, ...(existing.m ?? [])]
    const hasChest = layers.some(l => GameScene._CHEST_TILES.has(l))
    const existingGold = existing.metadata?.gold ?? 0
    const newTile: import('../world/types.ts').TileData = {
      g: existing.g,
      ...(existing.m || !hasChest
        ? { m: hasChest ? (existing.m ?? []) : [...(existing.m ?? []), 'chest'] }
        : {}),
      ...(existing.t ? { t: existing.t } : {}),
      metadata: {
        ...(existing.metadata ?? {}),
        dropped: hasChest ? (existing.metadata?.dropped ?? false) : true,
        opened: false,
        gold: existingGold + gold,
        items: existing.metadata?.items ?? [],
      },
    }

    setTile(tx, ty, newTile)
    this.tilemapRenderer.invalidateTile(tx, ty)
    void update(ref(db), {
      [(room || '0') === '0' ? overworldTilePath(tx, ty) : `map/${room}/${tileKey(tx, ty)}`]: newTile,
    })
    this._showFloatText(tx, ty, `+${gold} reclaimed`, '#ffdd88')
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
      const { damage: dmg, crit } = rollAttackDamage(attacker)
      void runTransaction(
        ref(db, `players/${id}/hp`),
        (hp: number | null) => (hp == null ? undefined : Math.max(0, hp - dmg)),
      )
      rec.sprite.setTint(0xff4444)
      this.time.delayedCall(150, () => { if (rec.sprite.active) rec.sprite.clearTint() })
      this._showFloatText(atx, aty, crit ? `CRIT! -${dmg}` : `-${dmg}`, crit ? '#ffaa33' : '#ff3333')
      return true
    }
    return false
  }

  /**
   * Handle an attack attempt from the local player.
   * - Melee weapons: instant hit on the facing tile.
   * - Ranged/magic weapons: spawn a projectile toward the facing direction.
   *   Magic requires sufficient MP; "No MP!" feedback shown if insufficient.
   */
  private async _handlePlayerAttack(tx: number, ty: number, direction: Direction): Promise<void> {
    const facingOffset: Record<Direction, [number, number]> = {
      down:  [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
    }
    const [dx, dy] = facingOffset[direction]
    const atx = tx + dx
    const aty = ty + dy

    const player = getLocalPlayer()

    // Determine weapon type to choose attack mode
    let weaponType: 'melee' | 'ranged' | 'magic' = 'melee'
    let weaponDef: import('../registry/types.ts').WeaponDefinition | null = null
    if (player.equippedWeapon) {
      try {
        weaponDef = WeaponRegistry.get(player.equippedWeapon)
        weaponType = weaponDef.weaponType
      } catch { /* bare-handed melee */ }
    }

    // ── Ranged / magic: spawn projectile ──────────────────────────────────
    if (weaponType === 'ranged' || weaponType === 'magic') {
      if (weaponType === 'magic') {
        const mpCost = weaponDef?.mpCostPerSwing ?? 5
        if (player.mp < mpCost) {
          this._showFloatText(tx, ty, 'No MP!', '#88ccff')
          return
        }
        player.mp = Math.max(0, player.mp - mpCost)
        setLocalPlayer(player)
        void update(ref(db), { [`players/${player.id}/mp`]: player.mp })
      }

      this.sound.play('sfx_swing', { volume: 0.5 })

      const { damage, crit } = rollAttackDamage(player)
      const speed = weaponDef?.projectileSpeed ?? (weaponType === 'ranged' ? 150 : 120)
      const range = weaponDef?.projectileRange ?? 8
      const element = weaponDef?.element ?? null

      // Air projectiles gain +50% speed; earth deals +30% upfront (armor break)
      const finalSpeed  = element === 'air'   ? speed * 1.5 : speed
      const finalDamage = element === 'earth' ? Math.round(damage * 1.3) : damage

      this._projectileSystem.spawn({
        ownerId:         player.id,
        startPx:         tx * TILE_SIZE + TILE_SIZE / 2,
        startPy:         ty * TILE_SIZE + TILE_SIZE / 2,
        directionDx:     dx,
        directionDy:     dy,
        speedPxPerSec:   finalSpeed,
        maxRangeTiles:   range,
        baseDamage:      finalDamage,
        crit,
        element,
        statusEffect:    weaponDef?.statusEffect,
        projectileSprite: weaponDef?.projectileSprite,
      })
      return
    }

    // ── Melee: immediate hit on the facing tile ────────────────────────────
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
      this._tryAttackPlayer(atx, aty)
      return
    }

    const { damage, crit } = rollAttackDamage(player)
    const currentHp = this._localEnemyHp.has(targetId)
      ? this._localEnemyHp.get(targetId)!
      : targetEntry.hp
    const newHp = currentHp - damage
    this._localEnemyHp.set(targetId, newHp)

    const enemyRec = this._remoteEnemies.get(targetId)
    if (enemyRec) {
      enemyRec.sprite.setTint(0xff4444)
      this.time.delayedCall(150, () => { if (enemyRec.sprite.active) enemyRec.sprite.clearTint() })
    }

    this._showFloatText(
      targetEntry.x, targetEntry.y,
      crit ? `CRIT! ${Math.max(0, newHp)}` : `${Math.max(0, newHp)}`,
      crit ? '#ffaa33' : '#ff3333',
    )

    if (newHp <= 0) {
      await this._resolveEnemyKill(targetId, targetEntry)
    } else {
      const room = getLocalPlayer().room
      await update(ref(db), {
        [`presence/${room}/enemies/${targetId}/hp`]: newHp,
        [`entities/enemies/${targetId}/hp`]:        newHp,
      })
    }
  }

  /**
   * Resolve a projectile hit: apply damage + elemental effects, then kill or wound.
   * Fire DOT schedules delayed hits; water writes slowEndAt; earth is baked into
   * the projectile's baseDamage at spawn time.
   */
  private async _handleProjectileHit(evt: ProjectileHitEvent): Promise<void> {
    const { enemyId, damage, crit, element, statusEffect, px, py } = evt

    const targetEntry = this._enemyData.get(enemyId)
    if (!targetEntry) return

    const player  = getLocalPlayer()
    const room    = player.room
    const hitTx   = Math.floor(px / TILE_SIZE)
    const hitTy   = Math.floor(py / TILE_SIZE)

    // Flash enemy with element tint
    const enemyRec = this._remoteEnemies.get(enemyId)
    if (enemyRec) {
      const tint = element === 'fire' ? 0xff6600 : element === 'water' ? 0x0099ff
        : element === 'earth' ? 0x88cc44 : element === 'air' ? 0xccffff : 0xff4444
      enemyRec.sprite.setTint(tint)
      this.time.delayedCall(150, () => { if (enemyRec.sprite.active) enemyRec.sprite.clearTint() })
    }

    const currentHp = this._localEnemyHp.has(enemyId)
      ? this._localEnemyHp.get(enemyId)!
      : targetEntry.hp
    const newHp = currentHp - damage
    this._localEnemyHp.set(enemyId, newHp)

    const hitColor = crit ? '#ffaa33'
      : element === 'fire'  ? '#ff6600'
      : element === 'water' ? '#00ccff'
      : element === 'earth' ? '#88cc44'
      : element === 'air'   ? '#aaffaa'
      : '#ff3333'
    this._showFloatText(hitTx, hitTy, crit ? `CRIT! ${Math.max(0, newHp)}` : `${Math.max(0, newHp)}`, hitColor)

    // Fire burn DOT: two delayed extra hits at fraction of base damage
    if (element === 'fire' && statusEffect?.type === 'burn') {
      const dotDmg = Math.max(1, Math.round(damage * statusEffect.value))
      const snap1  = { ...targetEntry }
      this.time.delayedCall(1000, () => {
        const h2 = (this._localEnemyHp.get(enemyId) ?? snap1.hp) - dotDmg
        if (h2 >= 0 || (this._localEnemyHp.get(enemyId) ?? 1) > 0) {
          this._localEnemyHp.set(enemyId, Math.max(0, h2))
          this._showFloatText(snap1.x, snap1.y, `+${dotDmg}`, '#ff8800')
          if (h2 <= 0) { void this._resolveEnemyKill(enemyId, snap1) }
          else { void update(ref(db), { [`presence/${room}/enemies/${enemyId}/hp`]: h2, [`entities/enemies/${enemyId}/hp`]: h2 }) }
        }
      })
      this.time.delayedCall(2000, () => {
        const h3 = (this._localEnemyHp.get(enemyId) ?? snap1.hp) - dotDmg
        if (h3 >= 0 || (this._localEnemyHp.get(enemyId) ?? 1) > 0) {
          this._localEnemyHp.set(enemyId, Math.max(0, h3))
          this._showFloatText(snap1.x, snap1.y, `+${dotDmg}`, '#ff8800')
          if (h3 <= 0) { void this._resolveEnemyKill(enemyId, snap1) }
          else { void update(ref(db), { [`presence/${room}/enemies/${enemyId}/hp`]: h3, [`entities/enemies/${enemyId}/hp`]: h3 }) }
        }
      })
    }

    // Water slow: write slowEndAt so AI scripts can read it
    if (element === 'water' && statusEffect?.type === 'slow') {
      void update(ref(db), {
        [`presence/${room}/enemies/${enemyId}/slowEndAt`]:   Date.now() + statusEffect.durationMs,
        [`entities/enemies/${enemyId}/slowEndAt`]:           Date.now() + statusEffect.durationMs,
      })
    }

    if (newHp <= 0) {
      await this._resolveEnemyKill(enemyId, targetEntry)
    } else {
      await update(ref(db), {
        [`presence/${room}/enemies/${enemyId}/hp`]: newHp,
        [`entities/enemies/${enemyId}/hp`]:        newHp,
      })
    }
  }

  /**
   * Shared kill-resolution logic used by both melee and projectile attack paths.
   * Grants XP/loot, checks level-up, removes the enemy from Firebase and cache.
   */
  private async _resolveEnemyKill(
    targetId: string,
    targetEntry: EnemyPresenceEntry,
  ): Promise<void> {
    const player = getLocalPlayer()
    const room   = player.room

    let template: import('../registry/types.ts').EnemyDefinition | null = null
    try { template = EnemyRegistry.get(targetEntry.templateId) } catch { /* unknown */ }

    const xpGain     = template ? Math.max(1, Math.floor(template.baseHp / 5)) : 1
    const newInventory = (player.inventory ?? []).map(s => ({ ...s }))
    let newGold      = player.gold ?? 0
    let goldGained   = 0
    const itemsGained: Record<string, number> = {}

    if (template) {
      for (const { itemId, min, max, chance } of template.lootTable) {
        if (Math.random() < chance) {
          const qty = Math.floor(Math.random() * (max - min + 1)) + min
          if (itemId === 'gold_coin') {
            newGold    += qty
            goldGained += qty
          } else {
            const slot = newInventory.find(s => s.itemId === itemId)
            if (slot) slot.quantity += qty
            else newInventory.push({ itemId, quantity: qty, metadata: {} })
            itemsGained[itemId] = (itemsGained[itemId] ?? 0) + qty
          }
        }
      }
    }

    let carriedGold = 0
    try {
      const snap = await get(ref(db, `entities/enemies/${targetId}/carriedGold`))
      carriedGold = Math.max(0, Number(snap.val() ?? 0))
    } catch { /* ignore */ }

    player.xp        = player.xp + xpGain
    player.gold      = newGold
    player.inventory = newInventory

    // Level-up check — each level grants 3 stat points (+1 every 5th level)
    const levelBefore  = player.level
    let levelsGained   = 0
    let totalPtsGained = 0
    while (player.xp >= xpForLevel(player.level + 1)) {
      const hpGain = 8 + Math.floor(player.stats.endurance * 0.6)
      const mpGain = 2 + Math.floor(player.stats.intelligence * 0.4)

      player.level += 1
      player.maxHp += hpGain
      player.hp     = Math.min(player.hp + hpGain, player.maxHp)
      player.maxMp += mpGain
      player.mp     = Math.min(player.mp + mpGain, player.maxMp)

      let ptGain = 3
      if (player.level % 5 === 0) ptGain += 1
      player.statPoints = (player.statPoints ?? 0) + ptGain
      totalPtsGained += ptGain
      levelsGained++
    }

    setLocalPlayer(player)

    if (levelsGained > 0) {
      const data: LevelUpSceneData = {
        newLevel:      player.level,
        pointsGranted: totalPtsGained,
        unlocks:       findNewUnlocks(levelBefore, player.level),
      }
      this.playerController.freeze()
      this.scene.launch('LevelUpScene', data)
      this.scene.get('LevelUpScene').events.once(
        Phaser.Scenes.Events.SHUTDOWN,
        () => this.playerController.unfreeze(),
      )
    }

    this._scriptExecutor.removeEnemy(targetId)
    this._localEnemyHp.delete(targetId)
    this._stolenByEnemy.delete(targetId)

    if (carriedGold > 0) {
      this._dropEnemyCarriedGold(room, targetEntry.x, targetEntry.y, carriedGold)
    }

    // ── Progress counters ─────────────────────────────────────────────────────
    const pc        = player.progressCounters ??= {}
    pc.enemiesKilledTotal = (pc.enemiesKilledTotal ?? 0) + 1
    const killMap   = pc.killsByEnemyId ??= {}
    const baseType  = template?.baseType ?? 'unknown'
    killMap[baseType] = (killMap[baseType] ?? 0) + 1
    if (goldGained > 0) {
      pc.goldCollectedTotal = (pc.goldCollectedTotal ?? 0) + goldGained
    }
    // Track non-gold items received from enemy loot (leather, crystals, etc.)
    if (Object.keys(itemsGained).length > 0) {
      const cbi = pc.collectedByItemId ??= {}
      for (const [itemId, gained] of Object.entries(itemsGained)) {
        cbi[itemId] = (cbi[itemId] ?? 0) + gained
      }
    }
    setLocalPlayer(player)

    // ── Quest advancement ──────────────────────────────────────────────────────
    const questResult = checkAndAdvanceQuestsLocally(player)

    await update(ref(db), {
      [`presence/${room}/enemies/${targetId}`]:  null,
      [`entities/enemies/${targetId}`]:          null,
      [`players/${player.id}/xp`]:               player.xp,
      [`players/${player.id}/gold`]:             player.gold,
      [`players/${player.id}/inventory`]:        newInventory,
      [`players/${player.id}/progressCounters/enemiesKilledTotal`]: pc.enemiesKilledTotal,
      [`players/${player.id}/progressCounters/killsByEnemyId/${baseType}`]: killMap[baseType],
      ...(goldGained > 0 && {
        [`players/${player.id}/progressCounters/goldCollectedTotal`]: pc.goldCollectedTotal,
      }),
      ...(pc.collectedByItemId && {
        [`players/${player.id}/progressCounters/collectedByItemId`]: pc.collectedByItemId,
      }),
      ...questResult.updates,
      ...(levelsGained > 0 && {
        [`players/${player.id}/level`]:      player.level,
        [`players/${player.id}/maxHp`]:      player.maxHp,
        [`players/${player.id}/hp`]:         player.hp,
        [`players/${player.id}/maxMp`]:      player.maxMp,
        [`players/${player.id}/mp`]:         player.mp,
        [`players/${player.id}/statPoints`]: player.statPoints,
      }),
    })

    // Quest reward level-up
    if (questResult.levelsGained > 0) {
      const luData: LevelUpSceneData = {
        newLevel:      player.level,
        pointsGranted: questResult.statPointsGranted,
        unlocks:       findNewUnlocks(questResult.levelBefore, player.level),
      }
      if (!this.scene.isActive('LevelUpScene')) {
        this.playerController.freeze()
        this.scene.launch('LevelUpScene', luData)
        this.scene.get('LevelUpScene').events.once(
          Phaser.Scenes.Events.SHUTDOWN,
          () => this.playerController.unfreeze(),
        )
      }
    }

    // Notify quest completions
    const tx = Math.floor(this.playerController.px / TILE_SIZE)
    const ty = Math.floor(this.playerController.py / TILE_SIZE)
    for (const title of questResult.completedTitles) {
      this._showFloatText(tx, ty, `Quest: ${title}`, '#ffdd44')
    }
  }

  /** Flush locally accumulated tile distance to Firebase and reset the buffer. */
  private _flushDistanceTraveled(): void {
    if (this._distAccum === 0) return
    const player = getLocalPlayer()
    const pc = player.progressCounters ??= {}
    pc.distanceTraveled = (pc.distanceTraveled ?? 0) + this._distAccum
    this._distAccum = 0
    setLocalPlayer(player)
    const questResult = checkAndAdvanceQuestsLocally(player)
    void update(ref(db), {
      [`players/${player.id}/progressCounters/distanceTraveled`]: pc.distanceTraveled,
      ...questResult.updates,
    })
  }

  /** Freeze the player and open the quest log overlay (Step 24). */
  private _openQuests(): void {
    this.playerController.freeze()
    this.scene.launch('QuestScene')
    this.scene.get('QuestScene').events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.playerController.unfreeze(),
    )
  }
}

