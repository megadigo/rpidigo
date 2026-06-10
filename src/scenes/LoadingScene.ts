/**
 * LoadingScene — preloads all spritesheets, runs WorldBootstrap, then launches GameScene.
 * Shows a progress bar while the seed/POI init completes.
 */
import Phaser from 'phaser'
import { ensureWorldReady } from '../world/WorldBootstrap.ts'
import { ensureRadius, ensureChunk, getTile, setTile, overworldTilePath } from '../world/ChunkManager.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import type { TileData } from '../world/types.ts'
import { isPassable } from '../world/CollisionMap.ts'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getTileSheets } from '../renderer/TilemapRenderer.ts'
import { enemies } from '../data/enemies.ts'
import { items } from '../data/items.ts'
import { weapons } from '../data/weapons.ts'
import { armors } from '../data/armors.ts'
import { loadPyodideRuntime } from '../world/ScriptExecutor.ts'

/** Champion id → file mapping (matches SPEC.md). */
const CHAMPION_FILES: Record<string, string> = {
  arthax:    'Arthax',
  borg:      'Börg',
  gangblanc: 'Gangblanc',
  grum:      'Grum',
  kanji:     'Kanji',
  katan:     'Katan',
  okomo:     'Okomo',
  zhinja:    'Zhinja',
}

/** All NPC sprite names (in public/assets/sprites/NPCs/). */
const NPC_SPRITES = [
  'dog',
  'guard_patrol', 'healer_standard', 'merchant_standard',
  'villager_fisherman', 'villager_gossiper', 'villager_hunter', 'villager_wanderer',
] as const

export class LoadingScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Rectangle
  private label!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'LoadingScene' })
  }

  preload(): void {
    // Tile spritesheets — derived from TILE_DEFS in TilemapRenderer (frame 0 convention)
    for (const key of getTileSheets()) {
      this.load.spritesheet(key, `assets/sprites/${key}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Champion spritesheets (80×128 — 5 frames × 8 rows: walk + attack)
    for (const [id, file] of Object.entries(CHAMPION_FILES)) {
      this.load.spritesheet(id, `assets/sprites/Player/${file}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Enemy spritesheets — most are 16×16 frames; some (e.g. boss) use a larger frame size.
    const enemySheetMap = new Map<string, number>()
    for (const e of enemies) {
      const key = `Enemies/${e.spriteFrame.replace('.png', '')}`
      enemySheetMap.set(key, e.frameSize ?? 16)
    }
    for (const [key, size] of enemySheetMap) {
      this.load.spritesheet(key, `assets/sprites/${key}.png`, { frameWidth: size, frameHeight: size })
    }
    // NPC spritesheets (80×128 — 5 frames × 8 rows: walk + attack)
    for (const name of NPC_SPRITES) {
      this.load.spritesheet(`NPCs/${name}`, `assets/sprites/NPCs/${name}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Item icons (16×16) — routed by category to their new directories
    for (const item of items) {
      const dir = item.category === 'tool' ? 'Tools' : 'Items'
      const key = `${dir}/${item.spriteFrame.replace('.png', '')}`
      this.load.image(key, `assets/sprites/${dir}/${item.spriteFrame}`)
    }
    for (const w of weapons) {
      const key = `Weapons/${w.spriteFrame.replace('.png', '')}`
      this.load.image(key, `assets/sprites/Weapons/${w.spriteFrame}`)
    }
    for (const a of armors) {
      const key = `Armors/${a.spriteFrame.replace('.png', '')}`
      this.load.image(key, `assets/sprites/Armors/${a.spriteFrame}`)
    }
    // Projectile spritesheets (4 directional frames: down/up/right/left).
    {
      const seen = new Set<string>()
      for (const w of weapons) {
        if (!w.projectileSprite || seen.has(w.projectileSprite)) continue
        seen.add(w.projectileSprite)
        const key = `Projectiles/${w.projectileSprite}`
        this.load.spritesheet(key, `assets/sprites/Projectiles/${w.projectileSprite}.png`, {
          frameWidth: 16,
          frameHeight: 16,
        })
      }
    }
    // Sound effects
    this.load.audio('sfx_swing',  'assets/music/swing.wav')
    this.load.audio('sfx_gather', 'assets/music/wood-small.wav')
    // Music tracks — loaded as audio assets for MusicDirector
    const MUSIC: Array<[string, string]> = [
      ['music_ambient_1', 'Ambient 1.mp3'],
      ['music_ambient_2', 'Ambient 2.mp3'],
      ['music_ambient_3', 'Ambient 3.mp3'],
      ['music_action_1',  'Action 1.mp3'],
      ['music_action_2',  'Action 2.mp3'],
      ['music_action_3',  'Action 3.mp3'],
      ['music_dark_1',    'Dark Ambient 1.mp3'],
      ['music_dark_2',    'Dark Ambient 2.mp3'],
      ['music_dark_3',    'Dark Ambient 3.mp3'],
    ]
    for (const [key, file] of MUSIC) {
      this.load.audio(key, `assets/music/${file}`)
    }
  }

  create(): void {
    const { width, height } = this.scale

    this.add.rectangle(width / 2, height / 2, width * 0.7, 6, 0x333333)
    this.bar = this.add.rectangle(width / 2 - (width * 0.7) / 2, height / 2, 0, 6, 0xffffff)
    this.bar.setOrigin(0, 0.5)

    this.label = this.add.text(width / 2, height / 2 + 14, 'Initialising world…', {
      fontFamily: 'monospace', fontSize: '8px', color: '#888',
    }).setOrigin(0.5, 0)

    void this._boot()
  }

  private setProgress(v: number, msg: string): Promise<void> {
    const targetWidth = this.scale.width * 0.7 * v
    this.label.setText(msg)
    return new Promise(resolve => {
      this.tweens.add({
        targets: this.bar,
        width: targetWidth,
        duration: 400,
        ease: 'Sine.easeInOut',
        onComplete: () => resolve(),
      })
    })
  }

  private async _boot(): Promise<void> {
    try {
      await this.setProgress(0.1, 'Connecting…')
      await ensureWorldReady()
      await this.setProgress(0.4, 'Generating spawn area…')

      const player = getLocalPlayer()
      const cx = Math.floor(player.x / 32)
      const cy = Math.floor(player.y / 32)
      await ensureRadius(cx, cy, 2)

      // Restore the house tile if it was lost (schema wipe or race condition).
      // The player record always has the correct coordinates, but the tile itself
      // may have been wiped along with all map data.
      const house = player.house
      if (house) {
        await ensureChunk(Math.floor(house.x / 32), Math.floor(house.y / 32))
        const existing = getTile(house.x, house.y)
        const hasHut = existing && [existing.g, ...(existing.m ?? [])].includes('house_hut')
        if (!hasHut) {
          const houseTile: TileData = { g: 'grass', m: ['house_hut'] }
          setTile(house.x, house.y, houseTile)
          void update(ref(db), { [overworldTilePath(house.x, house.y)]: houseTile })
        }
      }

      await this.setProgress(0.6, 'Loading AI runtime…')
      // Loads Pyodide WASM from CDN; continues silently if offline or blocked.
      await loadPyodideRuntime()

      // Ensure spawn is on a passable tile (spawn search runs before chunks load,
      // so the fallback pos (500,500) may land on a tree or other impassable tile).
      let { x: sx, y: sy } = player
      if (!isPassable(sx, sy)) {
        outer:
        for (let r = 1; r <= 30; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
              if (isPassable(sx + dx, sy + dy)) { sx += dx; sy += dy; break outer }
            }
          }
        }
        player.x = sx
        player.y = sy
        setLocalPlayer(player)
        await update(ref(db), {
          [`players/${player.id}/x`]: sx,
          [`players/${player.id}/y`]: sy,
        })
      }

      // One-time starter kit: every player gets an axe, pickaxe, and scythe
      // if they don't already own any of them (covers accounts made before crafting).
      await this._ensureStarterKit()

      await this.setProgress(1, 'Ready!')
      await new Promise(r => setTimeout(r, 300))
      this.scene.start('GameScene')
    } catch (err) {
      this.label.setText(`Error: ${String(err)}`)
      console.error('[LoadingScene]', err)
    }
  }

  /**
   * Give every player a starter axe, pickaxe, and scythe if they own none.
   * This runs once on first load and is a no-op on subsequent logins.
   */
  private async _ensureStarterKit(): Promise<void> {
    const player = getLocalPlayer()
    const inv = player.inventory ?? []
    const TOOLS = ['axe', 'pickaxe', 'scythe']
    const hasAny = inv.some(s => TOOLS.includes(s.itemId))
    if (hasAny) return   // already has at least one tool

    const newInv = [
      ...inv,
      { itemId: 'axe',     quantity: 1, metadata: {} },
      { itemId: 'pickaxe', quantity: 1, metadata: {} },
      { itemId: 'scythe',  quantity: 1, metadata: {} },
    ]
    player.inventory = newInv
    setLocalPlayer(player)
    await update(ref(db), { [`players/${player.id}/inventory`]: newInv })
  }
}
