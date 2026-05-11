/**
 * IntroScene — title screen shown once on first page load.
 * Uses a DOM overlay rendered over the Phaser canvas.
 */
import Phaser from 'phaser'

export class IntroScene extends Phaser.Scene {
  constructor() {
    super({ key: 'IntroScene' })
  }

  create(): void {
    // DOM overlay
    const overlay = document.createElement('div')
    overlay.id = 'intro-overlay'
    overlay.innerHTML = `
      <div class="intro-box">
        <h1 class="intro-title">rpidigo</h1>
        <p class="intro-tagline">A shared world awaits</p>
        <button id="intro-play-btn">Play</button>
      </div>
    `
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'display:flex',
      'align-items:center', 'justify-content:center',
      'background:#000', 'z-index:100',
    ].join(';')

    const style = document.createElement('style')
    style.textContent = `
      .intro-box { text-align:center; font-family:monospace; color:#fff; }
      .intro-title { font-size:3rem; letter-spacing:.3em; text-transform:uppercase; margin-bottom:.5rem; }
      .intro-tagline { font-size:1rem; color:#888; margin-bottom:2rem; }
      #intro-play-btn {
        font-family:monospace; font-size:1.2rem; padding:.6rem 2.5rem;
        background:transparent; border:2px solid #fff; color:#fff; cursor:pointer;
        letter-spacing:.15em; text-transform:uppercase;
      }
      #intro-play-btn:hover { background:#fff; color:#000; }
    `
    document.head.appendChild(style)
    document.body.appendChild(overlay)

    document.getElementById('intro-play-btn')!.addEventListener('click', () => {
      overlay.remove()
      style.remove()
      this.scene.start('LoginScene')
    })
  }
}
