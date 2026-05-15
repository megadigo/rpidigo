/**
 * LoadingScene — preloads all spritesheets, runs WorldBootstrap, then launches GameScene.
 * Shows a progress bar while the seed/POI init completes.
 */
import Phaser from 'phaser'
import { ensureWorldReady } from '../world/WorldBootstrap.ts'
import { ensureRadius } from '../world/ChunkManager.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { isPassable } from '../world/CollisionMap.ts'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getTileSheets } from '../renderer/TilemapRenderer.ts'
import { enemies } from '../data/enemies.ts'

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
      this.load.spritesheet(key, `/assets/sprites/${key}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Champion spritesheets
    for (const [id, file] of Object.entries(CHAMPION_FILES)) {
      this.load.spritesheet(id, `/assets/sprites/Champions/${file}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Enemy spritesheets — key: 'Enemies/{name}' (used by entity renderer in Step 6)
    const enemySheets = [...new Set(enemies.map(e => `Enemies/${e.spriteFrame.replace('.png', '')}`))]
    for (const key of enemySheets) {
      this.load.spritesheet(key, `/assets/sprites/${key}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // NPC spritesheets — key: 'NPCs/{name}'
    for (const name of NPC_SPRITES) {
      this.load.spritesheet(`NPCs/${name}`, `/assets/sprites/NPCs/${name}.png`, { frameWidth: 16, frameHeight: 16 })
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
      await this.setProgress(0.5, 'Generating spawn area…')

      const player = getLocalPlayer()
      const cx = Math.floor(player.x / 32)
      const cy = Math.floor(player.y / 32)
      await ensureRadius(cx, cy, 2)

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

      await this.setProgress(1, 'Ready!')
      await new Promise(r => setTimeout(r, 300))
      this.scene.start('GameScene')
    } catch (err) {
      this.label.setText(`Error: ${String(err)}`)
      console.error('[LoadingScene]', err)
    }
  }
}
