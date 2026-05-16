/**
 * GameScene — main gameplay: tilemap, player sprite, camera.
 *
 * Listens for 'enterRoom' and 'exitRoom' events from PlayerController to handle
 * transitions between the overworld and house/dungeon interior rooms.
 *
 * Step 5: subscribes to /presence/{room}/players and renders remote player
 * sprites with name labels, tweening positions on each Firebase update.
 * Step 6: subscribes to /presence/{room}/enemies and /presence/{room}/npcs and
 * renders entity sprites at frame 0 (display only, no AI).
 */
import Phaser from 'phaser'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase.ts'
import { TilemapRenderer, TILE_SIZE, isTileRoomExit } from '../renderer/TilemapRenderer.ts'
import type { Direction } from '../renderer/SpriteAnim.ts'
import { getFrame } from '../renderer/SpriteAnim.ts'
import { PlayerController } from '../player/PlayerController.ts'
import { enterRoom, exitRoom, findTileInRoom, getTile } from '../world/ChunkManager.ts'
import { HOUSE_ROOM_SIZE } from '../world/HouseGen.ts'
import { CELLAR_ROOM_SIZE } from '../world/CellarGen.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { remotePlayerTiles, isPassable } from '../world/CollisionMap.ts'
import { EnemyRegistry } from '../registry/registries.ts'

/** Tile bounds of the 1000×1000 overworld in pixels. */
const WORLD_PIXEL_SIZE = 1000 * TILE_SIZE

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

export class GameScene extends Phaser.Scene {
  private tilemapRenderer!: TilemapRenderer
  private playerController!: PlayerController

  /** Remote player sprites keyed by player ID. */
  private _remotePlayers = new Map<string, {
    sprite: Phaser.GameObjects.Image
    label: Phaser.GameObjects.Text
  }>()
  /** Enemy sprites keyed by enemy instance ID. */
  private _remoteEnemies = new Map<string, Phaser.GameObjects.Image>()
  /** NPC sprites keyed by NPC instance ID. */
  private _remoteNpcs = new Map<string, Phaser.GameObjects.Image>()

  /** Unsubscribe function for the current Firebase presence listener. */
  private _presenceUnsub: (() => void) | null = null
  /** Unsubscribe function for the current Firebase enemy listener. */
  private _enemyUnsub: (() => void) | null = null
  /** Unsubscribe function for the current Firebase NPC listener. */
  private _npcUnsub: (() => void) | null = null

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

    // Subscribe to the overworld presence room on startup
    this._subscribePresence(getLocalPlayer().room)

    // Clean up Firebase listeners when the scene shuts down
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this._presenceUnsub) { this._presenceUnsub(); this._presenceUnsub = null }
      if (this._enemyUnsub)    { this._enemyUnsub();    this._enemyUnsub    = null }
      if (this._npcUnsub)      { this._npcUnsub();      this._npcUnsub      = null }
    })
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

    for (const sprite of this._remoteEnemies.values()) sprite.destroy()
    this._remoteEnemies.clear()

    for (const sprite of this._remoteNpcs.values()) sprite.destroy()
    this._remoteNpcs.clear()

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
            const { sprite, label } = this._remotePlayers.get(id)!
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
            this._remotePlayers.set(id, { sprite, label })
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

      if (data) {
        for (const [id, entry] of Object.entries(data)) {
          incoming.add(id)
          const px = entry.x * TILE_SIZE + TILE_SIZE / 2
          const py = entry.y * TILE_SIZE + TILE_SIZE / 2

          if (this._remoteEnemies.has(id)) {
            this._remoteEnemies.get(id)!.setPosition(px, py)
          } else {
            let textureKey = 'Enemies/wolf' // fallback
            try {
              const def = EnemyRegistry.get(entry.templateId)
              textureKey = `Enemies/${def.spriteFrame.replace('.png', '')}`
            } catch { /* unknown template — use fallback */ }
            const sprite = this.add.image(px, py, textureKey)
              .setFrame(0)
              .setDepth(9)
            this._remoteEnemies.set(id, sprite)
          }
        }
      }

      for (const [id, sprite] of this._remoteEnemies.entries()) {
        if (!incoming.has(id)) {
          sprite.destroy()
          this._remoteEnemies.delete(id)
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
            this._remoteNpcs.get(id)!.setPosition(px, py)
          } else {
            const textureKey = `NPCs/${entry.templateId}`
            const sprite = this.add.image(px, py, textureKey)
              .setFrame(0)
              .setDepth(9)
            this._remoteNpcs.set(id, sprite)
          }
        }
      }

      for (const [id, sprite] of this._remoteNpcs.entries()) {
        if (!incoming.has(id)) {
          sprite.destroy()
          this._remoteNpcs.delete(id)
        }
      }
    })
  }
}
