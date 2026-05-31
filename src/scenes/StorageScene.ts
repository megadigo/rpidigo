/**
 * StorageScene — chest UI for every chest in the game.
 *
 * All chests share the same behaviour:
 *   - Pre-generated gold can be taken (one-way; gold cannot be deposited).
 *   - Items can be freely deposited and withdrawn by any player.
 *   - When multiple chests exist in the current room the ◀ / ▶ buttons let
 *     the player browse without closing the panel.
 *   - Death-loot chests (dropped:true) are removed from the tile once emptied.
 *
 * The personal house chest is identified by metadata.storage === true; no
 * engine code treats it differently — it simply starts empty and lives in a
 * single-chest room, so no navigation arrows appear.
 */
import Phaser from 'phaser'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { getTile, setTile } from '../world/ChunkManager.ts'
import { tileKey } from '../world/utils.ts'
import { WeaponRegistry, ArmorRegistry, ItemRegistry } from '../registry/registries.ts'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHEST_TILE_IDS = new Set(['chest', 'dungeon_chest', 'cellar_chest'])

// ─── Scene data ───────────────────────────────────────────────────────────────

export interface StorageSceneData {
  tileX:       number
  tileY:       number
  roomId:      string
  /** Ordered list of all chest positions in the room (for navigation). */
  chestList?:  Array<{ x: number; y: number }>
  /** Index of the currently opened chest within chestList. */
  chestIndex?: number
}

type StorageSlot = { itemId: string; quantity: number }

// ─── Scene ────────────────────────────────────────────────────────────────────

export class StorageScene extends Phaser.Scene {
  private _data!:      StorageSceneData
  private _chest:      StorageSlot[] = []
  private _gold:       number = 0
  private _chestList:  Array<{ x: number; y: number }> = []
  private _chestIndex: number = 0
  private _overlay:    HTMLDivElement | null = null
  private _style:      HTMLStyleElement | null = null

  constructor() {
    super({ key: 'StorageScene' })
  }

  init(data: StorageSceneData): void {
    this._data       = data
    this._chestList  = data.chestList ?? [{ x: data.tileX, y: data.tileY }]
    this._chestIndex = data.chestIndex ?? 0
    this._loadTileState(data.tileX, data.tileY)
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
    }
    this._buildOverlay()
  }

  // ── Internal state ────────────────────────────────────────────────────────────

  private _loadTileState(x: number, y: number): void {
    const tile  = getTile(x, y)
    this._chest = (tile?.metadata?.items ?? []).map(i => ({ ...i }))
    this._gold  = tile?.metadata?.gold ?? 0
  }

  // ── Build DOM ────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = STORAGE_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'st-overlay'
    this._overlay.innerHTML = this._html()
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#st-close')?.addEventListener('click', () => this._close())
    this._overlay.querySelector('#st-nav-prev')?.addEventListener('click', () => this._navigate(-1))
    this._overlay.querySelector('#st-nav-next')?.addEventListener('click', () => this._navigate(+1))
    this._overlay.querySelector('#st-take-all')?.addEventListener('click', () => this._takeAll())

    this._renderAll()
  }

  private _html(): string {
    const showNav = this._chestList.length > 1
    const nav = showNav
      ? `<button id="st-nav-prev" title="Previous chest">◀</button>
         <button id="st-nav-next" title="Next chest">▶</button>`
      : ''
    const idx = showNav
      ? ` <span id="st-chest-idx">(${this._chestIndex + 1}/${this._chestList.length})</span>`
      : ''

    return `
      <div id="st-box">
        <div id="st-header">
          <span id="st-title">${this._chestTypeLabel()}${idx}</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${nav}
            <span id="st-hint">[Esc] close</span>
            <button id="st-close">✕</button>
          </div>
        </div>
        <div id="st-content">
          <div id="st-chest-panel">
            <div class="st-section-title">Chest</div>
            <div id="st-gold-row"></div>
            <div id="st-chest-grid"></div>
            <div id="st-take-all-row">
              <button id="st-take-all">Take All</button>
            </div>
            <div class="st-action-hint">↑ click to take</div>
          </div>
          <div id="st-bag-panel">
            <div class="st-section-title">Backpack</div>
            <div id="st-bag-grid"></div>
            <div class="st-action-hint">↓ click to store</div>
          </div>
        </div>
      </div>`
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  private _renderAll(): void {
    this._renderGoldRow()
    this._renderChest()
    this._renderBag()
    this._updateNavIdx()
  }

  private _renderGoldRow(): void {
    const row = this._overlay?.querySelector('#st-gold-row')
    if (!row) return
    if (this._gold <= 0) { row.innerHTML = ''; return }
    row.innerHTML = `
      <div class="st-gold-row">
        <span class="st-gold-label">Gold: <strong>${this._gold}</strong></span>
        <button class="st-gold-take">Take</button>
      </div>`
    row.querySelector('.st-gold-take')?.addEventListener('click', () => this._takeGold())
  }

  private _renderChest(): void {
    const grid = this._overlay?.querySelector('#st-chest-grid')
    if (!grid) return
    if (!this._chest.length) { grid.innerHTML = '<div class="st-empty">Empty</div>'; return }

    grid.innerHTML = this._chest.map((s, i) => `
      <div class="st-cell" data-i="${i}" title="${_esc(this._name(s.itemId))}">
        <canvas class="st-icon" width="24" height="24"></canvas>
        ${s.quantity > 1 ? `<span class="st-qty">${s.quantity}</span>` : ''}
      </div>`).join('')

    this._chest.forEach((s, i) => {
      const c = grid.querySelector<HTMLCanvasElement>(`.st-cell[data-i="${i}"] .st-icon`)
      if (c) this._drawIcon(c, s.itemId)
    })
    grid.querySelectorAll<HTMLElement>('.st-cell').forEach(cell =>
      cell.addEventListener('click', () => this._withdraw(parseInt(cell.dataset.i!, 10))))
  }

  private _renderBag(): void {
    const grid = this._overlay?.querySelector('#st-bag-grid')
    if (!grid) return
    const inv = (getLocalPlayer().inventory ?? []).filter(s => s.itemId !== 'gold_coin')
    if (!inv.length) { grid.innerHTML = '<div class="st-empty">Empty</div>'; return }

    grid.innerHTML = inv.map((s, i) => `
      <div class="st-cell" data-i="${i}" title="${_esc(this._name(s.itemId))}">
        <canvas class="st-icon" width="24" height="24"></canvas>
        ${s.quantity > 1 ? `<span class="st-qty">${s.quantity}</span>` : ''}
      </div>`).join('')

    inv.forEach((s, i) => {
      const c = grid.querySelector<HTMLCanvasElement>(`.st-cell[data-i="${i}"] .st-icon`)
      if (c) this._drawIcon(c, s.itemId)
    })
    grid.querySelectorAll<HTMLElement>('.st-cell').forEach(cell =>
      cell.addEventListener('click', () => {
        const pos     = parseInt(cell.dataset.i!, 10)
        const fullInv = getLocalPlayer().inventory ?? []
        let count = 0
        for (let ri = 0; ri < fullInv.length; ri++) {
          if (fullInv[ri].itemId === 'gold_coin') continue
          if (count === pos) { this._deposit(ri); return }
          count++
        }
      }))
  }

  private _updateNavIdx(): void {
    const el = this._overlay?.querySelector('#st-chest-idx')
    if (el) el.textContent = `(${this._chestIndex + 1}/${this._chestList.length})`
  }

  // ── Transfer actions ─────────────────────────────────────────────────────────

  private _withdraw(idx: number): void {
    const item = this._chest[idx]
    if (!item) return
    const player = getLocalPlayer()
    const inv    = [...(player.inventory ?? [])]
    const slot   = inv.find(s => s.itemId === item.itemId)
    if (slot) slot.quantity += item.quantity
    else inv.push({ itemId: item.itemId, quantity: item.quantity, metadata: {} })
    this._chest.splice(idx, 1)
    player.inventory = inv
    setLocalPlayer(player)
    this._persist()
    this._renderAll()
  }

  private _deposit(invIdx: number): void {
    const player = getLocalPlayer()
    const inv    = [...(player.inventory ?? [])]
    const slot   = inv[invIdx]
    if (!slot || slot.itemId === 'gold_coin') return
    const chest = this._chest.find(s => s.itemId === slot.itemId)
    if (chest) chest.quantity += slot.quantity
    else this._chest.push({ itemId: slot.itemId, quantity: slot.quantity })
    inv.splice(invIdx, 1)
    player.inventory = inv
    setLocalPlayer(player)
    this._persist()
    this._renderAll()
  }

  private _takeGold(): void {
    if (this._gold <= 0) return
    const player = getLocalPlayer()
    player.gold  = (player.gold ?? 0) + this._gold
    this._gold   = 0
    setLocalPlayer(player)
    this._persist()
    this._renderAll()
  }

  private _takeAll(): void {
    const player = getLocalPlayer()
    if (this._gold > 0) {
      player.gold = (player.gold ?? 0) + this._gold
      this._gold  = 0
    }
    const inv = [...(player.inventory ?? [])]
    for (const item of this._chest) {
      const slot = inv.find(s => s.itemId === item.itemId)
      if (slot) slot.quantity += item.quantity
      else inv.push({ itemId: item.itemId, quantity: item.quantity, metadata: {} })
    }
    this._chest      = []
    player.inventory = inv
    setLocalPlayer(player)
    this._persist()
    this._renderAll()
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  private _navigate(delta: -1 | 1): void {
    const newIdx = (this._chestIndex + delta + this._chestList.length) % this._chestList.length
    const next   = this._chestList[newIdx]
    if (!next) return
    this._data       = { ...this._data, tileX: next.x, tileY: next.y }
    this._chestIndex = newIdx
    this._loadTileState(next.x, next.y)
    this._renderAll()
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private _persist(): void {
    const player  = getLocalPlayer()
    const tile    = getTile(this._data.tileX, this._data.tileY)
    if (!tile) return

    const isEmpty = this._gold <= 0 && this._chest.length === 0
    let newTile: import('../world/types.ts').TileData

    if (isEmpty && tile.metadata?.dropped) {
      // Death-loot chest: remove the chest overlay and restore the bare tile.
      const layers  = [tile.g, ...(tile.m ?? [])]
      const chestId = layers.find(l => CHEST_TILE_IDS.has(l))
      const newM    = (tile.m ?? []).filter(m => m !== chestId)
      const meta    = { ...(tile.metadata ?? {}) }
      delete meta.gold; delete meta.items; delete meta.opened; delete meta.dropped
      newTile = {
        g: tile.g,
        ...(newM.length ? { m: newM } : {}),
        ...(tile.t ? { t: tile.t } : {}),
        ...(Object.keys(meta).length ? { metadata: meta } : {}),
      }
    } else {
      newTile = {
        ...tile,
        metadata: {
          ...(tile.metadata ?? {}),
          gold:  this._gold,
          items: this._chest.filter(i => i.quantity > 0),
          ...(isEmpty ? { opened: true } : {}),
        },
      }
    }

    setTile(this._data.tileX, this._data.tileY, newTile)
    void update(ref(db), {
      [`map/${this._data.roomId}/${tileKey(this._data.tileX, this._data.tileY)}`]: newTile,
      [`players/${player.id}/gold`]:      player.gold,
      [`players/${player.id}/inventory`]: player.inventory,
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private _chestTypeLabel(): string {
    const tile   = getTile(this._data.tileX, this._data.tileY)
    const layers = tile ? [tile.g, ...(tile.m ?? [])] : []
    if (layers.includes('dungeon_chest')) return 'Dungeon Chest'
    if (layers.includes('cellar_chest'))  return 'Cellar Chest'
    return 'Chest'
  }

  private _name(id: string): string {
    try {
      if (WeaponRegistry.has(id)) return WeaponRegistry.get(id).name
      if (ArmorRegistry.has(id))  return ArmorRegistry.get(id).name
      if (ItemRegistry.has(id))   return ItemRegistry.get(id).name
    } catch { /* ignore */ }
    return id.replace(/_/g, ' ')
  }

  private _drawIcon(canvas: HTMLCanvasElement, itemId: string): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false

    let texKey: string | null = null
    try {
      if (WeaponRegistry.has(itemId)) {
        texKey = `Weapons/${WeaponRegistry.get(itemId).spriteFrame.replace('.png', '')}`
      } else if (ArmorRegistry.has(itemId)) {
        texKey = `Armors/${ArmorRegistry.get(itemId).spriteFrame.replace('.png', '')}`
      } else if (ItemRegistry.has(itemId)) {
        const item = ItemRegistry.get(itemId)
        texKey = `${item.category === 'tool' ? 'Tools' : 'Items'}/${item.spriteFrame.replace('.png', '')}`
      }
    } catch { /* ignore */ }

    if (texKey) {
      try {
        const src = this.textures.get(texKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement
        ctx.drawImage(src, 0, 0, 16, 16, 0, 0, 24, 24)
        return
      } catch { /* fall through */ }
    }

    const COLORS: Record<string, string> = {
      material: '#8b6914', consumable: '#c0392b', weapon: '#e67e22',
      tool: '#7f8c8d', key: '#f1c40f', armor: '#2980b9',
    }
    let cat = 'material'
    try {
      if (WeaponRegistry.has(itemId))     cat = 'weapon'
      else if (ArmorRegistry.has(itemId)) cat = 'armor'
      else if (ItemRegistry.has(itemId))  cat = ItemRegistry.get(itemId).category
    } catch { /* ignore */ }
    ctx.fillStyle = COLORS[cat] ?? '#555'
    ctx.fillRect(1, 1, 22, 22)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((itemId[0] ?? '?').toUpperCase(), 12, 13)
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

const STORAGE_CSS = `
  #st-overlay {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
    background: rgba(0,0,0,0.6);
    font-family: monospace;
  }
  #st-box {
    background: #111;
    border: 2px solid #555;
    border-radius: 3px;
    width: 480px; max-width: 96vw;
    padding: 14px 16px;
    color: #eee;
    box-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  #st-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px; margin-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  #st-title { font-size: 13px; color: #ffdd88; letter-spacing: 0.1em; }
  #st-chest-idx { color: #888; font-size: 11px; }
  #st-hint { font-size: 10px; color: #555; }
  #st-close {
    background: transparent; border: 1px solid #444;
    color: #888; font-family: monospace; font-size: 10px;
    padding: 1px 7px; cursor: pointer; line-height: 1.4;
  }
  #st-close:hover { border-color: #aaa; color: #fff; }
  #st-nav-prev, #st-nav-next {
    background: transparent; border: 1px solid #444;
    color: #aaa; font-family: monospace; font-size: 11px;
    padding: 1px 8px; cursor: pointer; line-height: 1.4;
  }
  #st-nav-prev:hover, #st-nav-next:hover { border-color: #ffdd88; color: #ffdd88; }

  #st-content { display: flex; gap: 14px; }
  #st-chest-panel, #st-bag-panel {
    flex: 1; display: flex; flex-direction: column; min-width: 0;
  }
  #st-chest-panel { border-right: 1px solid #222; padding-right: 14px; }
  .st-section-title {
    font-size: 9px; color: #666;
    letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;
  }
  .st-action-hint { font-size: 9px; color: #444; margin-top: 5px; }
  #st-chest-grid, #st-bag-grid {
    display: flex; flex-wrap: wrap; gap: 3px;
    align-content: flex-start;
    min-height: 80px; max-height: 200px; overflow-y: auto;
  }
  .st-cell {
    width: 36px; height: 36px;
    border: 1px solid #252525; border-radius: 2px;
    position: relative; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background: #0d0d0d; flex-shrink: 0;
  }
  .st-cell:hover { border-color: #888; background: #1a1a1a; }
  .st-icon { image-rendering: pixelated; }
  .st-qty {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 8px; color: #ffdd88;
    text-shadow: 1px 1px 0 #000; pointer-events: none; line-height: 1;
  }
  .st-empty { font-size: 11px; color: #333; padding: 6px 0; }
  .st-gold-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px; padding: 4px 6px;
    background: #1a1500; border: 1px solid #3a2e00; border-radius: 2px;
  }
  .st-gold-label { font-size: 11px; color: #ffdd88; }
  .st-gold-take {
    background: transparent; border: 1px solid #5a4a00;
    color: #ffdd88; font-family: monospace; font-size: 9px;
    padding: 1px 7px; cursor: pointer; line-height: 1.4;
  }
  .st-gold-take:hover { border-color: #ffdd88; }
  #st-take-all-row { display: flex; justify-content: flex-end; margin-top: 6px; }
  #st-take-all {
    background: transparent; border: 1px solid #444;
    color: #aaa; font-family: monospace; font-size: 9px;
    padding: 2px 10px; cursor: pointer; line-height: 1.4;
  }
  #st-take-all:hover { border-color: #aaa; color: #fff; }
`
