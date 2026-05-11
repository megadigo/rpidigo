import './style.css'
import Phaser from 'phaser'
import { bootstrapRegistries } from './registry/bootstrap'
import { IntroScene } from './scenes/IntroScene'
import { LoginScene } from './scenes/LoginScene'
import { LoadingScene } from './scenes/LoadingScene'
import { GameScene } from './scenes/GameScene'
import { HudScene } from './scenes/HudScene'

async function main(): Promise<void> {
  await bootstrapRegistries()

  new Phaser.Game({
    parent: 'game',
    width: 320,
    height: 180,
    pixelArt: true,
    backgroundColor: '#000000',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [IntroScene, LoginScene, LoadingScene, GameScene, HudScene],
  })
}

main().catch(console.error)
