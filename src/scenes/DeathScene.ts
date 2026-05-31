/**
 * DeathScene — full-screen overlay shown when the player's HP reaches zero.
 *
 * Displays:
 *   - "You Died" title
 *   - Killer name (enemy type or "Unknown")
 *   - Gold retained (never dropped on death)
 *   - Number of item stacks lost
 *   - 10-second auto-respawn countdown
 *   - "Respawn at House" button
 *
 * Stopping this scene (button or countdown) signals GameScene to run _respawn().
 */
import Phaser from 'phaser'

export interface DeathSceneData {
  killerName:   string | null
  goldRetained: number
  itemsLost:    number
}

export class DeathScene extends Phaser.Scene {
  private _data!:             DeathSceneData
  private _overlay:           HTMLDivElement | null = null
  private _style:             HTMLStyleElement | null = null
  private _countdownInterval: ReturnType<typeof setInterval> | null = null
  private _secondsLeft        = 10

  constructor() {
    super({ key: 'DeathScene' })
  }

  init(data: DeathSceneData): void {
    this._data         = data
    this._secondsLeft  = 10
  }

  create(): void {
    this._buildOverlay()
    this._startCountdown()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = DEATH_CSS
    document.head.appendChild(this._style)

    const killer    = this._data.killerName ?? 'Unknown'
    const gold      = this._data.goldRetained
    const items     = this._data.itemsLost
    const itemsLine = items > 0
      ? `<div class="ds-stat"><span class="ds-label">Items lost</span><span class="ds-value ds-bad">${items} stack${items !== 1 ? 's' : ''}</span></div>`
      : `<div class="ds-stat"><span class="ds-label">Items lost</span><span class="ds-value">None</span></div>`

    this._overlay = document.createElement('div')
    this._overlay.id = 'ds-overlay'
    this._overlay.innerHTML = `
      <div id="ds-box">
        <div id="ds-title">YOU DIED</div>
        <div id="ds-stats">
          <div class="ds-stat">
            <span class="ds-label">Killed by</span>
            <span class="ds-value ds-killer">${_esc(killer)}</span>
          </div>
          <div class="ds-stat">
            <span class="ds-label">Gold retained</span>
            <span class="ds-value ds-gold">${gold}</span>
          </div>
          ${itemsLine}
        </div>
        <div id="ds-countdown-wrap">
          <div id="ds-countdown-bar"><div id="ds-countdown-fill"></div></div>
          <div id="ds-countdown-label">Respawning in <strong id="ds-seconds">${this._secondsLeft}</strong>s</div>
        </div>
        <button id="ds-respawn-btn">Respawn at House</button>
      </div>`
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#ds-respawn-btn')?.addEventListener('click', () => this._doRespawn())
  }

  private _startCountdown(): void {
    this._countdownInterval = setInterval(() => {
      this._secondsLeft--
      const secEl  = this._overlay?.querySelector('#ds-seconds')
      const fillEl = this._overlay?.querySelector<HTMLElement>('#ds-countdown-fill')
      if (secEl) secEl.textContent = String(this._secondsLeft)
      if (fillEl) fillEl.style.width = `${(this._secondsLeft / 10) * 100}%`
      if (this._secondsLeft <= 0) this._doRespawn()
    }, 1000)
  }

  private _doRespawn(): void {
    if (this._countdownInterval !== null) {
      clearInterval(this._countdownInterval)
      this._countdownInterval = null
    }
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
    this.scene.stop()
  }

  shutdown(): void {
    if (this._countdownInterval !== null) {
      clearInterval(this._countdownInterval)
      this._countdownInterval = null
    }
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DEATH_CSS = `
  #ds-overlay {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
    background: rgba(0,0,0,0.82);
    font-family: monospace;
  }
  #ds-box {
    display: flex; flex-direction: column; align-items: center;
    gap: 20px;
    padding: 32px 40px;
    background: #0a0a0a;
    border: 2px solid #550000;
    border-radius: 3px;
    box-shadow: 0 0 40px rgba(200,0,0,0.25);
    min-width: 280px;
    max-width: 92vw;
  }
  #ds-title {
    font-size: 36px;
    letter-spacing: 8px;
    color: #cc2222;
    text-shadow: 0 0 18px #ff0000;
  }
  #ds-stats {
    width: 100%;
    display: flex; flex-direction: column; gap: 6px;
    border-top: 1px solid #2a0000;
    border-bottom: 1px solid #2a0000;
    padding: 12px 0;
  }
  .ds-stat {
    display: flex; justify-content: space-between; gap: 24px;
    font-size: 11px;
  }
  .ds-label { color: #555; }
  .ds-value { color: #ccc; }
  .ds-killer { color: #ff8888; }
  .ds-gold   { color: #ffdd88; }
  .ds-bad    { color: #ff6666; }
  #ds-countdown-wrap {
    width: 100%; display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  #ds-countdown-bar {
    width: 100%; height: 3px;
    background: #1a0000; border-radius: 2px; overflow: hidden;
  }
  #ds-countdown-fill {
    height: 100%; width: 100%;
    background: #aa2222;
    transition: width 0.9s linear;
  }
  #ds-countdown-label { font-size: 10px; color: #555; }
  #ds-respawn-btn {
    background: transparent;
    border: 1px solid #662222;
    color: #cc4444;
    font-family: monospace;
    font-size: 12px;
    padding: 7px 24px;
    cursor: pointer;
    letter-spacing: 0.06em;
    transition: border-color 0.15s, color 0.15s;
  }
  #ds-respawn-btn:hover { border-color: #cc4444; color: #ff6666; }
`
