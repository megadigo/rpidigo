/**
 * HudScene — persistent overlay above GameScene.
 * Phase 3: shows HP, MP, Gold, and player name.
 */
import Phaser from 'phaser'
import { getLocalPlayer } from '../player/Auth.ts'

export class HudScene extends Phaser.Scene {
  private hpText!: Phaser.GameObjects.Text
  private mpText!: Phaser.GameObjects.Text
  private goldText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'HudScene' })
  }

  create(): void {
    const style = { fontFamily: 'monospace', fontSize: '7px', color: '#ffffff', resolution: 2 }

    this.add.rectangle(0, 0, this.scale.width, 12, 0x000000, 0.6).setOrigin(0, 0).setDepth(100)

    const player = getLocalPlayer()
    this.add.text(4, 2, player.name, { ...style, color: '#ffdd88' }).setDepth(101)

    this.hpText   = this.add.text(80, 2, '', style).setDepth(101)
    this.mpText   = this.add.text(140, 2, '', style).setDepth(101)
    this.goldText = this.add.text(200, 2, '', style).setDepth(101)

    this._refresh()
  }

  update(): void {
    this._refresh()
  }

  private _refresh(): void {
    const p = getLocalPlayer()
    this.hpText.setText(`HP ${p.hp}/${p.maxHp}`)
    this.mpText.setText(`MP ${p.mp}/${p.maxMp}`)
    this.goldText.setText(`G ${p.gold}`)
  }
}
