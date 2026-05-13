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

/** All spritesheets loaded here: frameWidth/frameHeight = 16 (global sprite convention). */
const TILE_SHEETS = [
  'Ground/Grass', 'Ground/GrassTall', 'Ground/DeadGrass',
  'Ground/Shore', 'Ground/Cliff', 'Ground/Cliff-Water',
  'Nature/Trees', 'Nature/PineTrees', 'Nature/DeadTrees',
  'Nature/RockSmall', 'Nature/RocksBig', 'Nature/Cactus', 'Nature/Tumbleweed',
  'Ground/GrassFlowerYellow', 'Ground/GrassFlowerRed',
  'Buildings/Wood/Houses', 'Buildings/Wood/Huts', 'Buildings/Wood/Workshops',
  'Buildings/Wood/Market', 'Buildings/Wood/Taverns',
  'Miscellaneous/Bridge', 'Miscellaneous/Chests',
  'Miscellaneous/Well', 'Miscellaneous/Signs',
] as const

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

export class LoadingScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Rectangle
  private label!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'LoadingScene' })
  }

  preload(): void {
    // Tile spritesheets — frame 0 is the only frame used until animation is added
    for (const key of TILE_SHEETS) {
      this.load.spritesheet(key, `/assets/sprites/${key}.png`, { frameWidth: 16, frameHeight: 16 })
    }
    // Champion spritesheets
    for (const [id, file] of Object.entries(CHAMPION_FILES)) {
      this.load.spritesheet(id, `/assets/sprites/Characters/Champions/${file}.png`, { frameWidth: 16, frameHeight: 16 })
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

  private setProgress(v: number, msg: string): void {
    this.bar.width = this.scale.width * 0.7 * v
    this.label.setText(msg)
  }

  private async _boot(): Promise<void> {
    try {
      this.setProgress(0.1, 'Connecting…')
      await ensureWorldReady()
      this.setProgress(0.5, 'Generating spawn area…')

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

      this.setProgress(1, 'Ready!')
      await new Promise(r => setTimeout(r, 300))
      this.scene.start('GameScene')
    } catch (err) {
      this.label.setText(`Error: ${String(err)}`)
      console.error('[LoadingScene]', err)
    }
  }
}
