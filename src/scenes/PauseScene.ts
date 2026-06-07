/**
 * PauseScene — DOM overlay accessible from GameScene via Esc or the HUD menu
 * button. Resume returns to play; Settings exposes audio controls (mirroring
 * HudScene's music panel) and a read-only key-binding reference; Log Out marks
 * the player offline, clears their presence entry, and returns to LoginScene.
 */
import Phaser from 'phaser'
import { getLocalPlayer, logout } from '../player/Auth.ts'

const KEY_BINDINGS: Array<[string, string]> = [
  ['↑ ↓ ← →', 'Move'],
  ['A',              'Action — attack · interact · open · gather · talk'],
  ['I',              'Open inventory'],
  ['Enter',          'Open / send chat'],
  ['Esc',            'Close overlay / pause menu'],
]

export class PauseScene extends Phaser.Scene {
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _loggingOut = false

  constructor() {
    super({ key: 'PauseScene' })
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._resume())
    }
    this._buildOverlay()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    const savedVol = parseFloat(localStorage.getItem('rpidigo.music.volume') ?? '0.5')
    const savedOn  = (localStorage.getItem('rpidigo.music.enabled') ?? 'true') === 'true'

    this._style = document.createElement('style')
    this._style.textContent = PAUSE_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'pause-overlay'
    this._overlay.innerHTML = `
      <div id="pause-box">
        <div id="pause-title">PAUSED</div>
        <div id="pause-name">${_esc(getLocalPlayer().name)}</div>

        <div id="pause-actions">
          <button id="pause-resume">Resume</button>
          <button id="pause-settings-btn">Settings</button>
          <button id="pause-logout">Log Out</button>
        </div>

        <div id="pause-settings" class="hidden">
          <div class="ps-section">
            <div class="ps-title">Audio</div>
            <label class="ps-row">Music
              <button id="pause-music-toggle" class="${savedOn ? 'on' : ''}">${savedOn ? 'ON' : 'OFF'}</button>
            </label>
            <label class="ps-row">Volume
              <input id="pause-music-vol" type="range" min="0" max="100" value="${Math.round(savedVol * 100)}">
            </label>
          </div>
          <div class="ps-section">
            <div class="ps-title">Key Bindings</div>
            <div class="ps-keys">
              ${KEY_BINDINGS.map(([key, desc]) => `
                <div class="ps-key-row"><kbd>${_esc(key)}</kbd><span>${_esc(desc)}</span></div>
              `).join('')}
            </div>
          </div>
        </div>

        <div id="pause-hint">[Esc] Resume</div>
      </div>`
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#pause-resume')!.addEventListener('click', () => this._resume())
    this._overlay.querySelector('#pause-logout')!.addEventListener('click', () => void this._logout())

    const settingsBtn   = this._overlay.querySelector<HTMLButtonElement>('#pause-settings-btn')!
    const settingsPanel = this._overlay.querySelector<HTMLDivElement>('#pause-settings')!
    settingsBtn.addEventListener('click', () => {
      const hidden = settingsPanel.classList.toggle('hidden')
      settingsBtn.classList.toggle('open', !hidden)
    })

    const toggleBtn = this._overlay.querySelector<HTMLButtonElement>('#pause-music-toggle')!
    toggleBtn.addEventListener('click', () => {
      const nowOn = toggleBtn.classList.toggle('on')
      toggleBtn.textContent = nowOn ? 'ON' : 'OFF'
      this.game.events.emit('musicEnabled', nowOn)
    })

    const volSlider = this._overlay.querySelector<HTMLInputElement>('#pause-music-vol')!
    volSlider.addEventListener('input', () => {
      this.game.events.emit('musicVolume', parseInt(volSlider.value, 10) / 100)
    })
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  private _resume(): void {
    this._teardown()
    this.scene.stop()
  }

  private async _logout(): Promise<void> {
    if (this._loggingOut) return
    this._loggingOut = true
    const btn = this._overlay?.querySelector<HTMLButtonElement>('#pause-logout')
    if (btn) { btn.disabled = true; btn.textContent = 'Logging out…' }

    try {
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }

    this._teardown()
    if (this.scene.isActive('HudScene')) this.scene.stop('HudScene')
    this.scene.stop('GameScene')
    this.scene.start('LoginScene')
  }

  private _teardown(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
  }

  shutdown(): void {
    this._teardown()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PAUSE_CSS = `
  #pause-overlay {
    position: fixed; inset: 0; z-index: 200;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.78);
    font-family: monospace;
  }
  #pause-box {
    display: flex; flex-direction: column; align-items: center;
    gap: 14px;
    padding: 28px 36px;
    background: #0e0e0e;
    border: 1px solid #333;
    border-radius: 3px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.8);
    min-width: 260px;
    max-width: 92vw;
    color: #ddd;
  }
  #pause-title { font-size: 22px; letter-spacing: 0.3em; color: #ffdd88; }
  #pause-name  { font-size: 11px; color: #777; margin-top: -8px; }

  #pause-actions { display: flex; flex-direction: column; gap: 8px; width: 200px; }
  #pause-actions button {
    background: transparent; border: 1px solid #444;
    color: #ddd; font-family: monospace; font-size: 12px;
    padding: 8px 0; cursor: pointer; letter-spacing: 0.08em;
    transition: border-color 0.15s, color 0.15s;
  }
  #pause-actions button:hover  { border-color: #fff; color: #fff; }
  #pause-settings-btn.open     { border-color: #ffdd88; color: #ffdd88; }
  #pause-logout                { border-color: #662222; color: #cc6666; }
  #pause-logout:hover          { border-color: #cc4444; color: #ff8888; }
  #pause-logout:disabled       { opacity: 0.5; cursor: default; border-color: #444; color: #888; }

  #pause-settings { width: 100%; display: flex; flex-direction: column; gap: 14px; }
  #pause-settings.hidden { display: none; }

  .ps-section { display: flex; flex-direction: column; gap: 6px; }
  .ps-title {
    font-size: 10px; color: #ffdd88; letter-spacing: 0.14em;
    text-transform: uppercase; border-bottom: 1px solid #1a1a1a;
    padding-bottom: 4px;
  }
  .ps-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 11px; }
  #pause-music-toggle {
    background: rgba(255,255,255,0.06); border: 1px solid #444;
    color: #ccc; font-family: monospace; font-size: 10px;
    padding: 1px 8px; cursor: pointer;
  }
  #pause-music-toggle.on { border-color: #aaffaa; color: #aaffaa; }
  #pause-music-vol { width: 120px; accent-color: #ffdd44; cursor: pointer; }

  .ps-keys { display: flex; flex-direction: column; gap: 4px; }
  .ps-key-row { display: flex; gap: 10px; align-items: baseline; font-size: 10px; color: #bbb; line-height: 1.5; }
  .ps-key-row kbd {
    background: #1a1a1a; border: 1px solid #444; border-radius: 3px;
    padding: 0 5px; font-family: monospace; font-size: 9px; color: #eee;
    white-space: nowrap; flex-shrink: 0; min-width: 78px; text-align: center;
  }

  #pause-hint { font-size: 10px; color: #555; }
`
