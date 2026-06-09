/**
 * StatsScene — DOM overlay opened anytime via the "S" key. Shows the
 * player's primary stats and derived combat numbers, lets them spend any
 * banked stat points (same allocation + live-preview flow as LevelUpScene),
 * and offers a quick Log Out shortcut.
 *
 * Follows the same overlay pattern as PauseScene/LevelUpScene: freeze the
 * player in GameScene, launch this scene, unfreeze on its SHUTDOWN.
 */
import Phaser from 'phaser'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer, logout } from '../player/Auth.ts'
import { deriveCombatStats, applyDerivedCombatStats, type PrimaryStats } from '../world/playerStats.ts'

const STAT_ORDER: Array<keyof PrimaryStats> = ['strength', 'agility', 'intelligence', 'endurance']
const STAT_LABELS: Record<keyof PrimaryStats, string> = {
  strength:     'STR',
  agility:      'DEX',
  intelligence: 'INT',
  endurance:    'VIT',
}
const STAT_HINTS: Record<keyof PrimaryStats, string> = {
  strength:     'melee power, carry weight',
  agility:      'ranged power, crit chance',
  intelligence: 'magic power, max MP',
  endurance:    'max HP, defense',
}

function _esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function _pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

/** "42" when unchanged, "42 → 48" when the preview differs from the current value. */
function _arrow(curr: number, next: number, fmt: (n: number) => string = String): string {
  return curr === next ? fmt(curr) : `${fmt(curr)} → <span class="st-up">${fmt(next)}</span>`
}

export class StatsScene extends Phaser.Scene {
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _loggingOut = false

  /** Pending allocation chosen by the player — applied to `player.stats` on Confirm. */
  private _alloc: PrimaryStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0 }
  /** Snapshot of unspent points when the scene opened (the player is frozen, so it can't drift). */
  private _totalPoints = 0

  constructor() {
    super({ key: 'StatsScene' })
  }

  create(): void {
    this._totalPoints = getLocalPlayer().statPoints ?? 0
    this._alloc = { strength: 0, agility: 0, intelligence: 0, endurance: 0 }
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
      this.input.keyboard.once('keydown-S',   () => this._close())
    }
    this._buildOverlay()
    this._refresh()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    const player    = getLocalPlayer()
    const canAlloc  = this._totalPoints > 0

    this._style = document.createElement('style')
    this._style.textContent = STATS_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'st-overlay'
    this._overlay.innerHTML = `
      <div id="st-box">
        <div id="st-title">CHARACTER</div>
        <div id="st-name">${_esc(player.name)} · Level ${player.level}</div>

        ${canAlloc ? `<div id="st-points">Unspent points: <span id="st-remaining"></span></div>` : ''}

        <div id="st-stats">
          ${STAT_ORDER.map(stat => `
            <div class="st-stat-row">
              <div class="st-stat-label">
                <span class="st-stat-name">${STAT_LABELS[stat]}</span>
                <span class="st-stat-hint">${_esc(STAT_HINTS[stat])}</span>
              </div>
              ${canAlloc ? `<button class="st-stat-btn st-minus" data-stat="${stat}">−</button>` : ''}
              <span class="st-stat-value" data-stat="${stat}">${player.stats[stat]}</span>
              ${canAlloc ? `<button class="st-stat-btn st-plus" data-stat="${stat}">+</button>` : ''}
            </div>
          `).join('')}
        </div>

        <div id="st-preview">
          <div class="st-preview-title">Combat</div>
          <div class="st-preview-row"><span>Melee power</span><span data-key="meleePower"></span></div>
          <div class="st-preview-row"><span>Ranged power</span><span data-key="rangedPower"></span></div>
          <div class="st-preview-row"><span>Magic power</span><span data-key="magicPower"></span></div>
          <div class="st-preview-row"><span>Defense</span><span data-key="defense"></span></div>
          <div class="st-preview-row"><span>Crit chance</span><span data-key="critChance"></span></div>
        </div>

        ${canAlloc ? '<button id="st-confirm" disabled>Confirm</button>' : ''}
        <button id="st-logout">Log Out</button>
        <div id="st-hint">[Esc / S] Close</div>
      </div>`
    document.body.appendChild(this._overlay)

    for (const btn of this._overlay.querySelectorAll<HTMLButtonElement>('.st-minus')) {
      btn.addEventListener('click', () => this._adjust(btn.dataset.stat as keyof PrimaryStats, -1))
    }
    for (const btn of this._overlay.querySelectorAll<HTMLButtonElement>('.st-plus')) {
      btn.addEventListener('click', () => this._adjust(btn.dataset.stat as keyof PrimaryStats, 1))
    }
    this._overlay.querySelector('#st-confirm')?.addEventListener('click', () => this._confirm())
    this._overlay.querySelector('#st-logout')!.addEventListener('click', () => void this._logout())
  }

  // ── Allocation ────────────────────────────────────────────────────────────────

  private _spent(): number {
    return STAT_ORDER.reduce((sum, s) => sum + this._alloc[s], 0)
  }

  private _remaining(): number {
    return this._totalPoints - this._spent()
  }

  private _adjust(stat: keyof PrimaryStats, delta: number): void {
    if (delta > 0 && this._remaining() <= 0) return
    if (delta < 0 && this._alloc[stat] <= 0) return
    this._alloc[stat] += delta
    this._refresh()
  }

  /** Player's stats with the pending allocation applied — used for the live preview. */
  private _previewStats(): PrimaryStats {
    const base = getLocalPlayer().stats
    const out  = { ...base }
    for (const stat of STAT_ORDER) out[stat] = base[stat] + this._alloc[stat]
    return out
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  private _refresh(): void {
    if (!this._overlay) return
    const player    = getLocalPlayer()
    const remaining = this._remaining()

    const remainingEl = this._overlay.querySelector('#st-remaining')
    if (remainingEl) remainingEl.textContent = String(remaining)

    for (const stat of STAT_ORDER) {
      const el = this._overlay.querySelector<HTMLSpanElement>(`.st-stat-value[data-stat="${stat}"]`)
      if (!el) continue
      const alloc = this._alloc[stat]
      el.innerHTML = alloc > 0
        ? `${player.stats[stat]} <span class="st-up">+${alloc}</span>`
        : `${player.stats[stat]}`
    }
    for (const btn of this._overlay.querySelectorAll<HTMLButtonElement>('.st-plus')) {
      btn.disabled = remaining <= 0
    }
    for (const btn of this._overlay.querySelectorAll<HTMLButtonElement>('.st-minus')) {
      btn.disabled = this._alloc[btn.dataset.stat as keyof PrimaryStats] <= 0
    }

    const current = deriveCombatStats(player)
    const preview = deriveCombatStats(player, this._previewStats())
    const rows: Record<string, string> = {
      meleePower:  _arrow(current.meleePower, preview.meleePower),
      rangedPower: _arrow(current.rangedPower, preview.rangedPower),
      magicPower:  _arrow(current.magicPower, preview.magicPower),
      defense:     _arrow(current.defense, preview.defense),
      critChance:  _arrow(current.critChance, preview.critChance, _pct),
    }
    for (const [key, html] of Object.entries(rows)) {
      const el = this._overlay.querySelector<HTMLSpanElement>(`[data-key="${key}"]`)
      if (el) el.innerHTML = html
    }

    const confirmBtn = this._overlay.querySelector<HTMLButtonElement>('#st-confirm')
    if (confirmBtn) {
      confirmBtn.disabled = remaining !== 0
      confirmBtn.textContent = remaining === 0 ? 'Confirm' : `Confirm (${remaining} left to spend)`
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  private _confirm(): void {
    if (this._totalPoints <= 0 || this._remaining() !== 0) return
    const player = getLocalPlayer()
    for (const stat of STAT_ORDER) player.stats[stat] += this._alloc[stat]
    player.statPoints = Math.max(0, (player.statPoints ?? 0) - this._totalPoints)
    applyDerivedCombatStats(player)
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/stats`]:        player.stats,
      [`players/${player.id}/statPoints`]:   player.statPoints,
      [`players/${player.id}/power`]:        player.power,
      [`players/${player.id}/totalDefense`]: player.totalDefense,
    })

    this._teardown()
    this.scene.stop()
  }

  private async _logout(): Promise<void> {
    if (this._loggingOut) return
    this._loggingOut = true
    const btn = this._overlay?.querySelector<HTMLButtonElement>('#st-logout')
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

  private _close(): void {
    this._teardown()
    this.scene.stop()
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const STATS_CSS = `
  #st-overlay {
    position: fixed; inset: 0; z-index: 200;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.8);
    font-family: monospace;
  }
  #st-box {
    display: flex; flex-direction: column; align-items: stretch;
    gap: 10px;
    padding: 22px 28px;
    background: #0e0e0e;
    border: 1px solid #444;
    border-radius: 3px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.85);
    width: 300px;
    max-width: 92vw;
    max-height: 92vh;
    overflow-y: auto;
    color: #ddd;
  }
  #st-title { text-align: center; font-size: 18px; letter-spacing: 0.2em; color: #ffdd88; }
  #st-name  { text-align: center; font-size: 11px; color: #aaffaa; margin-top: -6px; }

  #st-points { font-size: 11px; text-align: center; color: #aaddff; }
  #st-remaining { color: #ffdd44; font-weight: bold; }

  #st-stats { display: flex; flex-direction: column; gap: 6px; }
  .st-stat-row { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 6px; }
  .st-stat-label { display: flex; flex-direction: column; line-height: 1.3; }
  .st-stat-name { font-size: 12px; color: #ffdd88; letter-spacing: 0.08em; }
  .st-stat-hint { font-size: 8px; color: #777; }
  .st-stat-value { font-size: 12px; min-width: 56px; text-align: center; }
  .st-stat-btn {
    background: transparent; border: 1px solid #444; color: #ddd;
    font-family: monospace; font-size: 13px; line-height: 1;
    width: 22px; height: 22px; cursor: pointer;
  }
  .st-stat-btn:hover:not(:disabled)  { border-color: #fff; color: #fff; }
  .st-stat-btn:active:not(:disabled) { transform: scale(0.94); }
  .st-stat-btn:disabled { opacity: 0.35; cursor: default; }

  #st-preview { border-top: 1px solid #1a1a1a; padding-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .st-preview-title { font-size: 9px; color: #ffdd88; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 2px; }
  .st-preview-row { display: flex; justify-content: space-between; font-size: 11px; color: #bbb; }
  .st-up { color: #aaffaa; font-weight: bold; }

  #st-confirm {
    margin-top: 4px;
    background: transparent; border: 1px solid #ffdd88; color: #ffdd88;
    font-family: monospace; font-size: 12px; letter-spacing: 0.1em;
    padding: 8px 0; cursor: pointer; transition: border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  #st-confirm:hover:not(:disabled) { border-color: #fff; color: #fff; }
  #st-confirm:disabled { opacity: 0.4; cursor: default; border-color: #444; color: #888; }

  #st-logout {
    background: transparent; border: 1px solid #662222; color: #cc6666;
    font-family: monospace; font-size: 12px; letter-spacing: 0.08em;
    padding: 8px 0; cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  #st-logout:hover:not(:disabled) { border-color: #cc4444; color: #ff8888; }
  #st-logout:disabled { opacity: 0.5; cursor: default; border-color: #444; color: #888; }

  #st-hint { text-align: center; font-size: 9px; color: #555; }
`
