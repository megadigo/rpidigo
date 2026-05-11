/**
 * LoadingScene — runs WorldBootstrap, then launches GameScene.
 * Shows a progress bar while the seed/POI init completes.
 */
import Phaser from 'phaser'
import { ensureWorldReady } from '../world/WorldBootstrap.ts'
import { ensureRadius } from '../world/ChunkManager.ts'
import { getLocalPlayer } from '../player/Auth.ts'

export class LoadingScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Rectangle
  private label!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'LoadingScene' })
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

      this.setProgress(1, 'Ready!')
      await new Promise(r => setTimeout(r, 300))
      this.scene.start('GameScene')
    } catch (err) {
      this.label.setText(`Error: ${String(err)}`)
      console.error('[LoadingScene]', err)
    }
  }
}
