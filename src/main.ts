import './style.css'
import Phaser from 'phaser'
import { bootstrapRegistries } from './registry/bootstrap'
import { IntroScene } from './scenes/IntroScene'
import { LoginScene } from './scenes/LoginScene'
import { LoadingScene } from './scenes/LoadingScene'
import { GameScene } from './scenes/GameScene'
import { HudScene } from './scenes/HudScene'
import { DialogScene } from './scenes/DialogScene'
import { InventoryScene } from './scenes/InventoryScene'
import { CraftScene } from './scenes/CraftScene'
import { ShopScene } from './scenes/ShopScene'
import { StorageScene } from './scenes/StorageScene'

async function main(): Promise<void> {
  await bootstrapRegistries()

  new Phaser.Game({
    parent: 'game',
    width: 640,
    height: 360,
    pixelArt: true,
    backgroundColor: '#000000',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [IntroScene, LoginScene, LoadingScene, GameScene, HudScene, DialogScene, InventoryScene, CraftScene, ShopScene, StorageScene],
  })
}

main().catch(console.error)
