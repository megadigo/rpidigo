/**
 * IntroScene — title screen shown once on first page load.
 * Background: screenshot.png. Game title: DIGON.
 * Buttons: Play → LoginScene, How to Play → InstructionsScene.
 */
import Phaser from 'phaser'

export class IntroScene extends Phaser.Scene {
  constructor() {
    super({ key: 'IntroScene' })
  }

  create(): void {
    const style = document.createElement('style')
    style.id = 'intro-style'
    style.textContent = `
      #intro-overlay {
        position: fixed; inset: 0; z-index: 100;
        display: flex; align-items: center; justify-content: center;
        background:
          linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.75)),
          url('screenshot.png') center / cover no-repeat;
        font-family: monospace;
      }
      .intro-box {
        text-align: center; color: #fff;
        display: flex; flex-direction: column; align-items: center; gap: 1rem;
      }
      .intro-title {
        font-size: clamp(1.5rem, 12vw, 25rem);
        letter-spacing: .55em;
        white-space: nowrap;
        color: #ffdd88; margin: 0;
        text-shadow: 0 0 30px rgba(255,200,60,.6), 0 2px 4px rgba(0,0,0,.9);
      }
      .intro-tagline { font-size: .95rem; color: #aaa; margin: 0; letter-spacing: .12em; }
      .intro-buttons { display: flex; flex-direction: column; gap: .75rem; margin-top: .5rem; }
      .intro-btn {
        font-family: monospace; font-size: 1.1rem; padding: .55rem 2.8rem;
        background: transparent; border: 1px solid rgba(255,255,255,.45);
        color: #fff; cursor: pointer; letter-spacing: .15em; text-transform: uppercase;
        transition: background .15s, border-color .15s;
      }
      .intro-btn:hover { background: rgba(255,255,255,.12); border-color: #fff; }
      .intro-btn.primary { border-color: #ffdd88; color: #ffdd88; }
      .intro-btn.primary:hover { background: rgba(255,221,136,.15); }
    `
    document.head.appendChild(style)

    const overlay = document.createElement('div')
    overlay.id = 'intro-overlay'
    overlay.innerHTML = `
      <div class="intro-box">
        <h1 class="intro-title">DIGON</h1>
        <p class="intro-tagline">A shared world awaits</p>
        <div class="intro-buttons">
          <button class="intro-btn primary" id="intro-play-btn">Play</button>
          <button class="intro-btn" id="intro-help-btn">How to Play</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    document.getElementById('intro-play-btn')!.addEventListener('click', () => {
      overlay.remove(); style.remove()
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      }
      this.scene.start('LoginScene')
    })
    document.getElementById('intro-help-btn')!.addEventListener('click', () => {
      overlay.remove(); style.remove()
      this.scene.start('InstructionsScene')
    })
  }
}
