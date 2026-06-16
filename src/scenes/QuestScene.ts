/**
 * QuestScene — DOM overlay opened via Q key or the HUD quest button.
 *
 * Two tabs:
 *  • Quests   — reads players/{id}/quests/active + completed from Firebase,
 *               grouped by category. Each category shows the current active
 *               quest with progress bars. Completed count per category shown.
 *  • Counters — reads players/{id}/progressCounters and lists every key with
 *               a human-readable label. Map-type counters expand as sub-lists.
 *
 * Follows the same DOM-overlay pattern as StatsScene / PauseScene.
 */
import Phaser from 'phaser'
import { ref, get } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer } from '../player/Auth.ts'
import type { ActiveQuest, QuestCategory } from '../world/types.ts'
import { QUEST_TEMPLATES } from '../data/quests.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function _resolveCounter(counters: Record<string, unknown>, key: string): number {
  const parts = key.split('.')
  if (parts.length === 1) {
    const v = counters[key]
    return typeof v === 'number' ? v : 0
  }
  const map = counters[parts[0]]
  if (!map || typeof map !== 'object') return 0
  const v = (map as Record<string, unknown>)[parts[1]]
  return typeof v === 'number' ? v : 0
}

const CATEGORY_ORDER: QuestCategory[] = ['combat', 'gathering', 'exploration']

const CATEGORY_LABELS: Record<QuestCategory, string> = {
  combat:      '⚔ Combat',
  gathering:   '🪵 Gathering & Crafting',
  exploration: '🗺 Exploration',
}

const COUNTER_LABELS: Record<string, string> = {
  enemiesKilledTotal:  'Enemies defeated',
  killsByEnemyId:      'Kills by enemy type',
  houseEntered:        'House entries',
  housesVisited:       'Houses visited',
  dungeonsVisited:     'Dungeons entered',
  villagesVisited:     'Villages discovered',
  chatMessagesSent:    'Chat messages sent',
  craftsDone:          'Crafts completed',
  craftedByItemId:     'Crafted items',
  goldCollectedTotal:  'Total gold collected',
  collectedByItemId:   'Items collected',
  deaths:              'Deaths',
  distanceTraveled:    'Distance traveled (tiles)',
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class QuestScene extends Phaser.Scene {
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _activeTab: 'quests' | 'counters' = 'quests'

  constructor() {
    super({ key: 'QuestScene' })
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-Q',   () => this._close())
      this.input.keyboard.once('keydown-ESC', () => this._close())
    }
    this._buildOverlay()
    void this._load()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = QUEST_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'qs-overlay'
    this._overlay.innerHTML = `
      <div id="qs-box">
        <div id="qs-title">QUEST LOG</div>
        <div id="qs-name">${_esc(getLocalPlayer().name)}</div>
        <div id="qs-tabs">
          <button class="qs-tab active" data-tab="quests">Quests</button>
          <button class="qs-tab" data-tab="counters">Counters</button>
        </div>
        <div id="qs-content"><div id="qs-loading">Loading…</div></div>
        <button id="qs-close">Close</button>
        <div id="qs-hint">[Q / Esc] Close</div>
      </div>`
    document.body.appendChild(this._overlay)

    for (const btn of this._overlay.querySelectorAll<HTMLButtonElement>('.qs-tab')) {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab as 'quests' | 'counters'
        for (const b of this._overlay!.querySelectorAll<HTMLButtonElement>('.qs-tab')) {
          b.classList.toggle('active', b === btn)
        }
        void this._load()
      })
    }
    this._overlay.querySelector('#qs-close')!.addEventListener('click', () => this._close())
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this._overlay) return
    const contentEl = this._overlay.querySelector<HTMLDivElement>('#qs-content')!
    contentEl.innerHTML = '<div id="qs-loading">Loading…</div>'

    const player = getLocalPlayer()
    if (this._activeTab === 'quests') {
      const [activeSnap, completedSnap] = await Promise.all([
        get(ref(db, `players/${player.id}/quests/active`)),
        get(ref(db, `players/${player.id}/quests/completed`)),
      ])
      const active    = (activeSnap.val()    ?? {}) as Record<string, ActiveQuest>
      const completed = (completedSnap.val() ?? {}) as Record<string, { completedAt: number }>
      contentEl.innerHTML = this._renderQuests(active, completed)
    } else {
      const snap = await get(ref(db, `players/${player.id}/progressCounters`))
      contentEl.innerHTML = this._renderCounters(snap.val() as Record<string, unknown> | null)
    }
  }

  // ── Renderers ─────────────────────────────────────────────────────────────────

  private _renderQuests(
    active: Record<string, ActiveQuest>,
    completed: Record<string, { completedAt: number }>,
  ): string {
    const counters = (getLocalPlayer().progressCounters ?? {}) as Record<string, unknown>
    const totalByCategory = Object.fromEntries(
      CATEGORY_ORDER.map(cat => [cat, QUEST_TEMPLATES.filter(t => t.category === cat).length]),
    )
    const doneByCategory = Object.fromEntries(
      CATEGORY_ORDER.map(cat => [
        cat,
        QUEST_TEMPLATES.filter(t => t.category === cat && !!completed[t.id]).length,
      ]),
    )

    return CATEGORY_ORDER.map(cat => {
      const quest       = active[cat] as ActiveQuest | undefined
      const doneCount   = doneByCategory[cat]
      const totalCount  = totalByCategory[cat]
      const allDone     = doneCount === totalCount

      const progressLine = allDone
        ? `<span class="qs-cat-done">All ${totalCount} quests complete!</span>`
        : `<span class="qs-cat-progress">${doneCount} / ${totalCount} completed</span>`

      const questCard = quest
        ? (() => {
            const objHtml = quest.objectives.map(obj => {
              const current = _resolveCounter(counters, obj.counterKey)
              const done    = current >= obj.goal
              const pct     = Math.min(100, Math.floor((current / obj.goal) * 100))
              return `
                <div class="qs-obj${done ? ' done' : ''}">
                  <div class="qs-obj-label">${_esc(obj.label)}</div>
                  <div class="qs-bar-wrap"><div class="qs-bar" style="width:${pct}%"></div></div>
                  <div class="qs-obj-progress">${current} / ${obj.goal}</div>
                </div>`
            }).join('')
            return `
              <div class="qs-quest">
                <div class="qs-quest-title">${_esc(quest.title)}</div>
                <div class="qs-quest-desc">${_esc(quest.description)}</div>
                ${objHtml}
                <div class="qs-quest-reward">Reward: ${quest.rewardXp} XP${quest.rewardGold ? ` + ${quest.rewardGold} Gold` : ''}</div>
              </div>`
          })()
        : allDone
          ? ''
          : '<div class="qs-empty-cat">No active quest in this category.</div>'

      return `
        <div class="qs-category">
          <div class="qs-cat-header">
            <span class="qs-cat-label">${_esc(CATEGORY_LABELS[cat])}</span>
            ${progressLine}
          </div>
          ${questCard}
        </div>`
    }).join('')
  }

  private _renderCounters(data: Record<string, unknown> | null): string {
    if (!data || Object.keys(data).length === 0) {
      return '<div class="qs-empty">No progress recorded yet.</div>'
    }
    return Object.entries(data).map(([key, val]) => {
      const label = COUNTER_LABELS[key] ?? key
      if (val !== null && typeof val === 'object') {
        const subRows = Object.entries(val as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `<div class="qs-counter-sub">${_esc(k)}<span>${v}</span></div>`)
          .join('')
        return `<div class="qs-counter"><div class="qs-counter-label">${_esc(label)}</div>${subRows}</div>`
      }
      return `<div class="qs-counter"><span class="qs-counter-label">${_esc(label)}</span><span class="qs-counter-val">${val}</span></div>`
    }).join('')
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

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

const QUEST_CSS = `
  #qs-overlay {
    position: fixed; inset: 0; z-index: 200;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.82);
    font-family: monospace;
  }
  #qs-box {
    display: flex; flex-direction: column; align-items: stretch;
    gap: 10px;
    padding: 22px 28px;
    background: #0e0e0e;
    border: 1px solid #444;
    border-radius: 3px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.85);
    width: 360px;
    max-width: 94vw;
    max-height: 90vh;
    color: #ddd;
  }
  #qs-title { text-align: center; font-size: 18px; letter-spacing: 0.2em; color: #ffdd88; }
  #qs-name  { text-align: center; font-size: 11px; color: #aaffaa; margin-top: -6px; }

  #qs-tabs { display: flex; gap: 6px; }
  .qs-tab {
    flex: 1;
    background: transparent; border: 1px solid #333;
    color: #777; font-family: monospace; font-size: 11px;
    padding: 5px 0; cursor: pointer; letter-spacing: 0.08em;
    transition: border-color 0.15s, color 0.15s;
  }
  .qs-tab:hover  { border-color: #aaa; color: #ddd; }
  .qs-tab.active { border-color: #ffdd88; color: #ffdd88; }

  #qs-content {
    overflow-y: auto;
    max-height: 56vh;
    display: flex; flex-direction: column; gap: 8px;
    scrollbar-width: thin; scrollbar-color: #333 transparent;
  }
  #qs-loading { color: #555; text-align: center; font-size: 11px; padding: 16px 0; }
  .qs-empty   { color: #555; text-align: center; font-size: 11px; padding: 20px 0; }

  /* ── Category sections ── */
  .qs-category {
    border: 1px solid #222; border-radius: 2px; padding: 7px 9px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .qs-cat-header {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px solid #1e1e1e; padding-bottom: 4px; margin-bottom: 2px;
  }
  .qs-cat-label    { font-size: 11px; color: #ffdd88; letter-spacing: 0.06em; }
  .qs-cat-progress { font-size: 9px;  color: #666; }
  .qs-cat-done     { font-size: 9px;  color: #44ee88; }
  .qs-empty-cat    { font-size: 10px; color: #555; padding: 3px 0; }

  /* ── Quest cards ── */
  .qs-quest {
    display: flex; flex-direction: column; gap: 3px;
  }
  .qs-quest-title { font-size: 11px; color: #fff; }
  .qs-quest-desc  { font-size: 9px; color: #777; margin-bottom: 2px; }

  .qs-obj { display: flex; flex-direction: column; gap: 1px; }
  .qs-obj-label { font-size: 9px; color: #aaddff; }
  .qs-bar-wrap  { background: #181818; height: 4px; border-radius: 2px; overflow: hidden; }
  .qs-bar       { height: 100%; background: #4488ff; border-radius: 2px; }
  .qs-obj.done .qs-bar       { background: #44ee88; }
  .qs-obj.done .qs-obj-label { color: #44ee88; }
  .qs-obj-progress { font-size: 8px; color: #555; text-align: right; }
  .qs-quest-reward { font-size: 9px; color: #aaffaa; margin-top: 2px; }

  /* ── Counter rows ── */
  .qs-counter {
    display: flex; flex-direction: column;
    font-size: 11px; padding: 3px 0;
    border-bottom: 1px solid #181818;
  }
  .qs-counter > .qs-counter-label {
    display: flex; justify-content: space-between;
  }
  .qs-counter-label { color: #aaa; }
  .qs-counter-val   { color: #fff; font-weight: bold; }
  .qs-counter-sub {
    padding-left: 12px; font-size: 10px; color: #777;
    display: flex; justify-content: space-between; padding-top: 1px;
  }
  .qs-counter-sub span { color: #ccc; }

  /* ── Footer ── */
  #qs-close {
    background: transparent; border: 1px solid #444; color: #ddd;
    font-family: monospace; font-size: 12px; padding: 8px 0; cursor: pointer;
    letter-spacing: 0.08em; transition: border-color 0.15s, color 0.15s;
  }
  #qs-close:hover { border-color: #fff; color: #fff; }
  #qs-hint { text-align: center; font-size: 9px; color: #555; }
`

