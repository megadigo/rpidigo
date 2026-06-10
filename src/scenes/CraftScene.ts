/**
 * CraftScene — DOM overlay for crafting (Step 11 part 3).
 *
 * Launched additively by GameScene when the player presses E adjacent to a
 * crafting station (workbench, workshop, dungeon_altar).
 *
 * Layout:
 *   Left column  — recipe list, filtered to the current station and player level
 *   Right column — selected recipe details: produces, requires, craft button
 *
 * On craft:
 *   - Ingredients removed from player.inventory
 *   - Output added to player.inventory
 *   - Changes written to Firebase
 *
 * Stations:
 *   workbench    — basic tools, wooden weapons, leather armour, potions
 *   workshop     — iron weapons and armour (blacksmith forge)
 *   dungeon_altar — shadow-tier gear
 */
import Phaser from 'phaser'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { RecipeRegistry, ItemRegistry, WeaponRegistry, ArmorRegistry } from '../registry/registries.ts'
import type { RecipeDefinition } from '../registry/types.ts'
import { checkAndAdvanceQuestsLocally } from '../world/questUtils.ts'

// ─── Scene data ───────────────────────────────────────────────────────────────

export interface CraftSceneData {
  station: 'workbench' | 'workshop' | 'dungeon_altar'
}

const STATION_LABEL: Record<string, string> = {
  workbench:    'Workbench',
  workshop:     'Blacksmith Forge',
  dungeon_altar: 'Dungeon Altar',
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class CraftScene extends Phaser.Scene {
  private _data!: CraftSceneData
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _selected: RecipeDefinition | null = null

  constructor() {
    super({ key: 'CraftScene' })
  }

  init(data: CraftSceneData): void {
    this._data     = data
    this._selected = null
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
      this.input.keyboard.once('keydown-C',   () => this._close())
    }
    this._buildOverlay()
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = CRAFT_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'craft-overlay'
    this._overlay.innerHTML = `
      <div id="craft-box">
        <div id="craft-header">
          <span id="craft-title">${_esc(STATION_LABEL[this._data.station] ?? 'Crafting')}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span id="craft-hint">[C] / [Esc] close</span>
            <button id="craft-close">✕</button>
          </div>
        </div>
        <div id="craft-content">
          <div id="craft-list-wrap">
            <div class="craft-section-title">Recipes</div>
            <div id="craft-list"></div>
          </div>
          <div id="craft-detail">
            <div id="craft-detail-inner">
              <div class="craft-section-title">Select a recipe</div>
            </div>
            <div id="craft-toast"></div>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#craft-close')?.addEventListener('click', () => this._close())
    this._renderList()
  }

  // ── Recipe list ───────────────────────────────────────────────────────────

  private _renderList(): void {
    const player  = getLocalPlayer()
    const listEl  = this._overlay?.querySelector('#craft-list')
    if (!listEl) return

    const recipes = RecipeRegistry.getAll().filter(r => r.station === this._data.station)
    if (!recipes.length) {
      listEl.innerHTML = '<div class="craft-empty">No recipes available.</div>'
      return
    }

    listEl.innerHTML = recipes.map(r => {
      const locked    = player.level < r.levelRequired
      const craftable = !locked && this._canCraft(r)
      const cls       = locked ? 'craft-row locked' : craftable ? 'craft-row craftable' : 'craft-row'
      const sprite    = this._spriteUrl(r.produces)
      return `<div class="${cls}" data-id="${r.id}">
        ${sprite ? `<img class="craft-sprite" src="${sprite}" alt="">` : ''}
        <span class="craft-row-name">${_esc(this._outputName(r))}</span>
        ${locked ? `<span class="craft-row-lvl">Lv.${r.levelRequired}</span>` : ''}
      </div>`
    }).join('')

    listEl.querySelectorAll<HTMLElement>('.craft-row:not(.locked)').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id!
        try { this._selected = RecipeRegistry.get(id) } catch { return }
        listEl.querySelectorAll('.craft-row').forEach(r => r.classList.remove('selected'))
        el.classList.add('selected')
        this._renderDetail()
      })
    })
  }

  // ── Detail panel ──────────────────────────────────────────────────────────

  private _renderDetail(): void {
    const detail = this._overlay?.querySelector('#craft-detail-inner')
    if (!detail || !this._selected) return

    const r      = this._selected
    const player = getLocalPlayer()
    const inv    = player.inventory ?? []

    const reqRows = r.requires.map(req => {
      const have    = inv.find(s => s.itemId === req.itemId)?.quantity ?? 0
      const color   = have >= req.qty ? '#88ffcc' : '#ff8888'
      const reqSprite = this._spriteUrl(req.itemId)
      return `<div class="req-row">
        ${reqSprite ? `<img class="craft-sprite" src="${reqSprite}" alt="">` : ''}
        <span class="req-name">${_esc(this._itemName(req.itemId))}</span>
        <span class="req-count" style="color:${color}">${have}/${req.qty}</span>
      </div>`
    }).join('')

    const craftable    = this._canCraft(r)
    const outputName   = this._outputName(r)
    const outputSprite = this._spriteUrl(r.produces)

    detail.innerHTML = `
      <div class="craft-section-title">Recipe</div>
      <div id="craft-output-row">
        ${outputSprite ? `<img class="craft-sprite-lg" src="${outputSprite}" alt="">` : ''}
        <div id="craft-output-name">${_esc(outputName)}${r.quantity > 1 ? ` ×${r.quantity}` : ''}</div>
      </div>
      <div class="craft-section-title" style="margin-top:10px">Requires</div>
      <div id="craft-reqs">${reqRows}</div>
      <button id="craft-btn" ${craftable ? '' : 'disabled'}>Craft</button>
    `

    detail.querySelector('#craft-btn')?.addEventListener('click', () => {
      if (this._selected) this._craft(this._selected)
    })
  }

  // ── Craft action ──────────────────────────────────────────────────────────

  private _craft(r: RecipeDefinition): void {
    const player = getLocalPlayer()
    player.inventory ??= []
    const inv = [...player.inventory]

    // Consume ingredients
    for (const req of r.requires) {
      let remaining = req.qty
      for (const slot of inv) {
        if (slot.itemId !== req.itemId) continue
        const take = Math.min(slot.quantity, remaining)
        slot.quantity -= take
        remaining     -= take
        if (remaining === 0) break
      }
      if (remaining > 0) {
        this._showToast('Missing ingredients.')
        return
      }
    }

    // Remove exhausted slots
    const cleanInv = inv.filter(s => s.quantity > 0)

    // Add output
    const outSlot = cleanInv.find(s => s.itemId === r.produces)
    if (outSlot) {
      outSlot.quantity += r.quantity
    } else {
      cleanInv.push({ itemId: r.produces, quantity: r.quantity, metadata: {} })
    }

    player.inventory = cleanInv
    setLocalPlayer(player)

    // ── Progress counters ─────────────────────────────────────────────────────
    const pc = player.progressCounters ??= {}
    pc.craftsDone = (pc.craftsDone ?? 0) + 1
    const cbi = pc.craftedByItemId ??= {}
    cbi[r.produces] = (cbi[r.produces] ?? 0) + r.quantity
    setLocalPlayer(player)
    const questResult = checkAndAdvanceQuestsLocally(player)

    void update(ref(db), {
      [`players/${player.id}/inventory`]: cleanInv,
      [`players/${player.id}/progressCounters/craftsDone`]: pc.craftsDone,
      [`players/${player.id}/progressCounters/craftedByItemId/${r.produces}`]: cbi[r.produces],
      ...questResult.updates,
    })

    for (const title of questResult.completedTitles) {
      this._showToast(`Quest complete: ${title}`)
    }

    // Quest reward level-up — let GameScene handle the overlay via a game event
    if (questResult.levelsGained > 0) {
      this.game.events.emit('questLevelUp', {
        newLevel:          getLocalPlayer().level,
        levelBefore:       questResult.levelBefore,
        statPointsGranted: questResult.statPointsGranted,
      })
    }

    this._showToast(`Crafted: ${this._outputName(r)}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`)
    this._renderList()
    this._renderDetail()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _canCraft(r: RecipeDefinition): boolean {
    const player = getLocalPlayer()
    if (player.level < r.levelRequired) return false
    const inv = player.inventory ?? []
    return r.requires.every(req => {
      const have = inv.find(s => s.itemId === req.itemId)?.quantity ?? 0
      return have >= req.qty
    })
  }

  private _outputName(r: RecipeDefinition): string {
    return this._itemName(r.produces)
  }

  private _itemName(id: string): string {
    try {
      if (WeaponRegistry.has(id)) return WeaponRegistry.get(id).name
      if (ArmorRegistry.has(id))  return ArmorRegistry.get(id).name
      if (ItemRegistry.has(id))   return ItemRegistry.get(id).name
    } catch { /* ignore */ }
    return id.replace(/_/g, ' ')
  }

  private _spriteUrl(id: string): string {
    try {
      let def: { spriteFrame: string; category: string } | undefined
      if (WeaponRegistry.has(id))     def = WeaponRegistry.get(id)
      else if (ArmorRegistry.has(id)) def = ArmorRegistry.get(id)
      else if (ItemRegistry.has(id))  def = ItemRegistry.get(id)
      if (!def) return ''
      const dir = def.category === 'weapon' ? 'Weapons'
                : def.category === 'armor'  ? 'Armors'
                : def.category === 'tool'   ? 'Tools'
                : 'Items'
      return `assets/sprites/${dir}/${def.spriteFrame}`
    } catch { return '' }
  }

  private _showToast(msg: string): void {
    const toast = this._overlay?.querySelector<HTMLElement>('#craft-toast')
    if (!toast) return
    toast.textContent = msg
    toast.style.opacity = '1'
    clearTimeout((toast as HTMLElement & { _t?: number })._t)
    ;(toast as HTMLElement & { _t?: number })._t = window.setTimeout(
      () => { toast.style.opacity = '0' }, 2500,
    )
  }

  private _close(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
    this.scene.stop()
  }

  shutdown(): void {
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

const CRAFT_CSS = `
  #craft-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    background: rgba(0,0,0,0.6);
    font-family: monospace;
  }
  #craft-box {
    background: #111;
    border: 2px solid #555;
    border-radius: 3px;
    width: 480px;
    max-width: 96vw;
    padding: 14px 16px;
    color: #eee;
    box-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  #craft-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  #craft-title { font-size: 13px; color: #ffdd88; letter-spacing: 0.1em; }
  #craft-hint  { font-size: 10px; color: #555; }
  #craft-close {
    background: transparent;
    border: 1px solid #444;
    color: #888;
    font-family: monospace;
    font-size: 10px;
    padding: 1px 7px;
    cursor: pointer;
    line-height: 1.4;
  }
  #craft-close:hover { border-color: #aaa; color: #fff; }
  #craft-content { display: flex; gap: 14px; min-height: 240px; }

  /* ── Recipe list ── */
  #craft-list-wrap { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; }
  .craft-section-title {
    font-size: 9px; color: #666;
    letter-spacing: 0.12em; text-transform: uppercase;
    margin-bottom: 6px;
  }
  #craft-list { flex: 1; overflow-y: auto; }
  .craft-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid #1e1e1e;
    margin-bottom: 2px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 10px;
  }

  .craft-row:not(.locked):hover { border-color: #555; background: #1a1a1a; }
  .craft-row.selected { border-color: #aaa; background: #1e1e22; }
  .craft-row.craftable .craft-row-name { color: #88ffcc; }
  .craft-row.locked { opacity: 0.4; cursor: default; }
  .craft-row-name { flex: 1; color: #ccc; }
  .craft-row-lvl  { font-size: 9px; color: #ff8844; }
  .craft-empty { font-size: 11px; color: #444; padding: 6px 0; }

  /* ── Detail panel ── */
  #craft-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .craft-sprite {
    width: 16px;
    height: 16px;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    flex-shrink: 0;
    object-fit: none;
    object-position: 0 0;
  }
  .craft-sprite-lg {
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    flex-shrink: 0;
  }
  #craft-output-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  #craft-output-name {
    font-size: 12px;
    color: #fff;
  }
  #craft-reqs { margin-top: 4px; }
  .req-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #bbb;
    padding: 2px 0;
  }
  .req-name  { color: #bbb; flex: 1; }
  .req-count { font-size: 10px; letter-spacing: 0.04em; }
  #craft-btn {
    margin-top: 14px;
    width: 100%;
    background: #1a1a1a;
    border: 1px solid #666;
    color: #fff;
    font-family: monospace;
    font-size: 11px;
    padding: 5px;
    cursor: pointer;
    letter-spacing: 0.05em;
  }
  #craft-btn:hover:not(:disabled) { border-color: #aaa; background: #222; }
  #craft-btn:disabled { opacity: 0.35; cursor: default; }
  #craft-toast {
    margin-top: 8px;
    text-align: center;
    font-size: 10px;
    color: #88ffcc;
    min-height: 14px;
    opacity: 0;
    transition: opacity 0.3s;
  }
`
