/**
 * ShopScene — village merchant shop with zone-based pricing, per-village jitter,
 * and limited-stock enforcement (Step 14 full economy).
 *
 * Pricing model:
 *   adjustedBuyPrice  = baseBuyPrice × zoneMult × (1 + jitter)
 *   adjustedSellPrice = adjustedBuyPrice × entry.sellMultiplier
 *
 * Zone multipliers (from SPEC):
 *   forest  — wood, leather armors ×0.7 cheaper;  iron_ore, iron_bar ×1.4 expensive
 *   river   — leather ×0.7 cheaper;               stone, iron_ore ×1.4 expensive
 *   desert  — wood ×1.4 expensive
 *   plains  — no modifiers in current stock
 *
 * Per-village jitter: ±15 % seeded from (worldSeed ^ villageX ^ villageY).
 *
 * Limited stock tracked in Firebase under /shops/{villageId}.
 * Restocks once per 24 h real-time; purchases use a Firebase transaction.
 */
import Phaser from 'phaser'
import { ref, get, update, runTransaction } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { shopStock } from '../data/shop.ts'
import type { ShopStockEntry } from '../registry/types.ts'
import { WeaponRegistry, ArmorRegistry, ItemRegistry } from '../registry/registries.ts'
import { mulberry32 } from '../world/utils.ts'

// ─── Zone price modifier tables ───────────────────────────────────────────────
// Only lists item IDs that appear in shopStock — others have no effect.

const ZONE_CHEAPER: Record<string, string[]> = {
  plains:  [],
  forest:  ['wood', 'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_gloves'],
  river:   ['leather'],
  desert:  [],
}
const ZONE_EXPENSIVE: Record<string, string[]> = {
  plains:  [],
  forest:  ['iron_ore', 'iron_bar'],
  river:   ['stone', 'iron_ore'],
  desert:  ['wood'],
}

/** Sell gold for items that have no shop entry, keyed by category. */
const SELL_FALLBACK: Record<string, number> = {
  material: 2, consumable: 6, weapon: 15, armor: 12, tool: 8, key: 0,
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ShopSceneData {
  villageId:   string   // e.g. 'v_3_4'
  zone:        string   // 'plains' | 'forest' | 'river' | 'desert'
  villageSeed: number   // worldSeed ^ village.x ^ village.y
}

type Tab = 'buy' | 'sell'

// ─── Scene ────────────────────────────────────────────────────────────────────

export class ShopScene extends Phaser.Scene {
  private _data!: ShopSceneData
  /** Price jitter in [-0.15, 0.15], fixed per village. */
  private _jitter  = 0
  /** Remaining quantities for limited-stock items; loaded from Firebase. */
  private _stock: Record<string, number> = {}

  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _tab: Tab = 'buy'
  private _toastTimer = 0

  constructor() {
    super({ key: 'ShopScene' })
  }

  init(data: ShopSceneData): void {
    this._data   = data ?? { villageId: 'unknown', zone: 'plains', villageSeed: 0 }
    this._jitter = mulberry32(this._data.villageSeed)() * 0.3 - 0.15
    this._stock  = {}
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
      this.input.keyboard.once('keydown-A',   () => this._close())
    }
    this._buildOverlay()
    void this._loadStockThenRender()
  }

  // ── Stock management ────────────────────────────────────────────────────────

  private async _loadStockThenRender(): Promise<void> {
    const snap = await get(ref(db, `shops/${this._data.villageId}`))
    const raw  = snap.val() as Record<string, number> | null
    const now  = Date.now()

    if (!raw || typeof raw.restockAt !== 'number' || now >= raw.restockAt) {
      // First visit or daily restock — initialize all limited-item quantities.
      const init: Record<string, number> = { restockAt: now + 24 * 60 * 60 * 1000 }
      for (const s of shopStock) {
        if (s.maxQuantity !== -1) init[s.itemId] = s.maxQuantity
      }
      this._stock = init
      const fb: Record<string, number> = {}
      for (const [k, v] of Object.entries(init))
        fb[`shops/${this._data.villageId}/${k}`] = v
      void update(ref(db), fb)
    } else {
      this._stock = raw
    }

    this._render()
  }

  /** Remaining quantity for an item: -1 = unlimited, 0+ = limited count. */
  private _available(itemId: string): number {
    const entry = shopStock.find(s => s.itemId === itemId)
    if (!entry || entry.maxQuantity === -1) return -1
    return this._stock[itemId] ?? 0
  }

  // ── Pricing ─────────────────────────────────────────────────────────────────

  private _adjustedBuyPrice(entry: ShopStockEntry): number {
    const zone = this._data.zone
    let mult = 1.0
    if (ZONE_CHEAPER[zone]?.includes(entry.itemId))  mult *= 0.7
    if (ZONE_EXPENSIVE[zone]?.includes(entry.itemId)) mult *= 1.4
    mult *= (1 + this._jitter)
    return Math.max(1, Math.round(entry.baseBuyPrice * mult))
  }

  private _adjustedSellPrice(itemId: string): number {
    const entry = shopStock.find(s => s.itemId === itemId)
    if (entry) {
      return Math.max(1, Math.floor(this._adjustedBuyPrice(entry) * entry.sellMultiplier))
    }
    let cat = 'material'
    try {
      if (WeaponRegistry.has(itemId))     cat = 'weapon'
      else if (ArmorRegistry.has(itemId)) cat = 'armor'
      else if (ItemRegistry.has(itemId))  cat = ItemRegistry.get(itemId).category
    } catch { /* ignore */ }
    return SELL_FALLBACK[cat] ?? 2
  }

  // ── Build DOM ───────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = SHOP_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'shop-overlay'
    this._overlay.innerHTML = `
      <div id="shop-box">
        <div id="shop-header">
          <div>
            <span id="shop-title">Merchant</span>
            <span id="shop-zone"></span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span id="shop-gold">Gold 0</span>
            <button id="shop-close">✕</button>
          </div>
        </div>
        <div id="shop-tabs">
          <button class="shop-tab active" data-tab="buy">Buy</button>
          <button class="shop-tab" data-tab="sell">Sell</button>
        </div>
        <div id="shop-list"><div class="shop-empty">Loading…</div></div>
        <div id="shop-toast"></div>
      </div>
    `
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#shop-close')?.addEventListener('click', () => this._close())
    this._overlay.querySelectorAll<HTMLElement>('.shop-tab').forEach(el => {
      el.addEventListener('click', () => {
        this._tab = el.dataset.tab as Tab
        this._render()
      })
    })

    // Show zone badge (cosmetic only)
    const zoneEl = this._overlay.querySelector('#shop-zone')
    if (zoneEl) zoneEl.textContent = this._data.zone !== 'plains' ? ` · ${this._data.zone}` : ''
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  private _render(): void {
    this._updateGold()
    this._overlay?.querySelectorAll<HTMLElement>('.shop-tab').forEach(el =>
      el.classList.toggle('active', el.dataset.tab === this._tab))
    if (this._tab === 'buy') this._renderBuy()
    else this._renderSell()
  }

  private _renderBuy(): void {
    const list = this._overlay?.querySelector('#shop-list')
    if (!list) return
    const player = getLocalPlayer()

    list.innerHTML = shopStock.map((s, i) => {
      const price    = this._adjustedBuyPrice(s)
      const avail    = this._available(s.itemId)
      const lvl      = this._levelRequired(s.itemId)
      const soldOut  = avail === 0
      const lockedLvl = player.level < lvl
      const tooPoor  = (player.gold ?? 0) < price
      const disabled = soldOut || lockedLvl || tooPoor

      const stockBadge = avail === -1
        ? ''
        : avail === 0
          ? `<span class="shop-stock sold-out">sold out</span>`
          : `<span class="shop-stock">${avail} left</span>`

      const btnLabel = lockedLvl ? `Lv.${lvl}` : 'Buy'

      return `<div class="shop-row" data-i="${i}">
        <canvas class="shop-icon" width="24" height="24"></canvas>
        <span class="shop-name">${_esc(this._itemName(s.itemId))}${lvl > 1 ? ` <span class="shop-lvl">Lv.${lvl}</span>` : ''}</span>
        ${stockBadge}
        <span class="shop-price">${price}g</span>
        <button class="shop-act" data-i="${i}" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
      </div>`
    }).join('')

    shopStock.forEach((s, i) => {
      const canvas = list.querySelector<HTMLCanvasElement>(`.shop-row[data-i="${i}"] .shop-icon`)
      if (canvas) this._drawIcon(canvas, s.itemId)
    })
    list.querySelectorAll<HTMLButtonElement>('.shop-act:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => void this._buy(parseInt(btn.dataset.i!, 10)))
    })
  }

  private _renderSell(): void {
    const list = this._overlay?.querySelector('#shop-list')
    if (!list) return
    const inv      = getLocalPlayer().inventory ?? []
    const sellable = inv.filter(s => s.itemId !== 'gold_coin')

    if (!sellable.length) {
      list.innerHTML = '<div class="shop-empty">Nothing to sell.</div>'
      return
    }

    list.innerHTML = sellable.map(slot => {
      const realIdx = inv.indexOf(slot)
      const price   = this._adjustedSellPrice(slot.itemId)
      return `<div class="shop-row" data-i="${realIdx}">
        <canvas class="shop-icon" width="24" height="24"></canvas>
        <span class="shop-name">${_esc(this._itemName(slot.itemId))}${slot.quantity > 1 ? ` <span class="shop-lvl">×${slot.quantity}</span>` : ''}</span>
        <span class="shop-stock"></span>
        <span class="shop-price">${price}g</span>
        <button class="shop-act" data-i="${realIdx}" ${price <= 0 ? 'disabled' : ''}>Sell</button>
      </div>`
    }).join('')

    sellable.forEach(slot => {
      const realIdx = inv.indexOf(slot)
      const canvas  = list.querySelector<HTMLCanvasElement>(`.shop-row[data-i="${realIdx}"] .shop-icon`)
      if (canvas) this._drawIcon(canvas, slot.itemId)
    })
    list.querySelectorAll<HTMLButtonElement>('.shop-act:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => this._sell(parseInt(btn.dataset.i!, 10)))
    })
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  private async _buy(stockIdx: number): Promise<void> {
    const s = shopStock[stockIdx]
    if (!s) return
    const player = getLocalPlayer()
    const price  = this._adjustedBuyPrice(s)

    if (player.level < this._levelRequired(s.itemId)) { this._toast('Level too low.'); return }
    if ((player.gold ?? 0) < price)                   { this._toast('Not enough gold.'); return }

    // Limited stock: decrement via Firebase transaction to prevent overselling.
    if (s.maxQuantity !== -1) {
      const stockRef = ref(db, `shops/${this._data.villageId}/${s.itemId}`)
      const result   = await runTransaction(stockRef, (current: number | null) => {
        const qty = current ?? 0
        return qty > 0 ? qty - 1 : undefined  // undefined = abort
      })
      if (!result.committed) {
        this._stock[s.itemId] = 0
        this._toast('Sold out!')
        this._render()
        return
      }
      this._stock[s.itemId] = Math.max(0, (this._stock[s.itemId] ?? 1) - 1)
    }

    player.gold = (player.gold ?? 0) - price
    const inv      = [...(player.inventory ?? [])]
    const existing = this._stackable(s.itemId) ? inv.find(x => x.itemId === s.itemId) : undefined
    if (existing) existing.quantity += 1
    else inv.push({ itemId: s.itemId, quantity: 1, metadata: {} })
    player.inventory = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/gold`]:      player.gold,
      [`players/${player.id}/inventory`]: inv,
    })
    this._toast(`Bought ${this._itemName(s.itemId)} (${price}g)`)
    this._render()
  }

  private _sell(invIdx: number): void {
    const player = getLocalPlayer()
    const inv    = [...(player.inventory ?? [])]
    const slot   = inv[invIdx]
    if (!slot) return
    const price = this._adjustedSellPrice(slot.itemId)
    if (price <= 0) { this._toast('Cannot sell that.'); return }

    if (slot.quantity > 1) inv[invIdx] = { ...slot, quantity: slot.quantity - 1 }
    else inv.splice(invIdx, 1)
    player.inventory = inv
    player.gold      = (player.gold ?? 0) + price
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/gold`]:      player.gold,
      [`players/${player.id}/inventory`]: inv,
    })
    this._toast(`Sold ${this._itemName(slot.itemId)} (+${price}g)`)
    this._render()
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _levelRequired(id: string): number {
    try { if (WeaponRegistry.has(id)) return WeaponRegistry.get(id).levelRequired } catch { /* ignore */ }
    try { if (ArmorRegistry.has(id))  return ArmorRegistry.get(id).levelRequired  } catch { /* ignore */ }
    return 1
  }

  private _stackable(id: string): boolean {
    try { if (ItemRegistry.has(id)) return ItemRegistry.get(id).stackable } catch { /* ignore */ }
    return false
  }

  private _itemName(id: string): string {
    try {
      if (WeaponRegistry.has(id)) return WeaponRegistry.get(id).name
      if (ArmorRegistry.has(id))  return ArmorRegistry.get(id).name
      if (ItemRegistry.has(id))   return ItemRegistry.get(id).name
    } catch { /* ignore */ }
    return id.replace(/_/g, ' ')
  }

  private _updateGold(): void {
    const el = this._overlay?.querySelector('#shop-gold')
    if (el) el.textContent = `Gold ${getLocalPlayer().gold ?? 0}`
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
        const dir  = item.category === 'tool' ? 'Tools' : 'Items'
        texKey = `${dir}/${item.spriteFrame.replace('.png', '')}`
      }
    } catch { /* ignore */ }

    if (texKey) {
      try {
        const src = this.textures.get(texKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement
        ctx.drawImage(src, 0, 0, 16, 16, 0, 0, 24, 24)
        return
      } catch { /* fall through to placeholder */ }
    }

    const CATEGORY_COLOR: Record<string, string> = {
      material: '#8b6914', consumable: '#c0392b', weapon: '#e67e22',
      tool: '#7f8c8d', key: '#f1c40f', armor: '#2980b9',
    }
    let category = 'material'
    try {
      if (WeaponRegistry.has(itemId))     category = 'weapon'
      else if (ArmorRegistry.has(itemId)) category = 'armor'
      else if (ItemRegistry.has(itemId))  category = ItemRegistry.get(itemId).category
    } catch { /* ignore */ }

    ctx.fillStyle = CATEGORY_COLOR[category] ?? '#555555'
    ctx.fillRect(1, 1, 22, 22)
    ctx.fillStyle    = '#ffffff'
    ctx.font         = 'bold 12px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((itemId[0] ?? '?').toUpperCase(), 12, 13)
  }

  private _toast(msg: string): void {
    const toast = this._overlay?.querySelector<HTMLElement>('#shop-toast')
    if (!toast) return
    toast.textContent = msg
    toast.style.opacity = '1'
    clearTimeout(this._toastTimer)
    this._toastTimer = window.setTimeout(() => { toast.style.opacity = '0' }, 2200)
  }

  private _close(): void {
    clearTimeout(this._toastTimer)
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
    this.scene.stop()
  }

  shutdown(): void {
    clearTimeout(this._toastTimer)
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

const SHOP_CSS = `
  #shop-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    background: rgba(0,0,0,0.6);
    font-family: monospace;
  }
  #shop-box {
    background: #111;
    border: 2px solid #555;
    border-radius: 3px;
    width: 460px;
    max-width: 96vw;
    max-height: 90vh;
    overflow-y: auto;
    padding: 14px 16px;
    color: #eee;
    box-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  #shop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 8px;
    border-bottom: 1px solid #333;
  }
  #shop-title { font-size: 13px; color: #ffdd88; letter-spacing: 0.1em; }
  #shop-zone  { font-size: 10px; color: #888; margin-left: 4px; }
  #shop-gold  { font-size: 11px; color: #ffdd88; }
  #shop-close {
    background: transparent;
    border: 1px solid #444;
    color: #888;
    font-family: monospace;
    font-size: 10px;
    padding: 1px 7px;
    cursor: pointer;
    line-height: 1.4;
  }
  #shop-close:hover { border-color: #aaa; color: #fff; }

  #shop-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
  .shop-tab {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #333;
    color: #999;
    font-family: monospace;
    font-size: 11px;
    padding: 4px;
    cursor: pointer;
    letter-spacing: 0.05em;
  }
  .shop-tab.active { border-color: #aaa; color: #fff; background: #222; }
  .shop-tab:hover  { color: #fff; }

  #shop-list {
    max-height: min(200px, 30vh);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
    scrollbar-width: thin;
  }
  .shop-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 5px;
    border: 1px solid #1e1e1e;
    border-radius: 2px;
  }
  .shop-row:hover { border-color: #444; background: #1a1a1a; }
  .shop-icon   { image-rendering: pixelated; flex-shrink: 0; }
  .shop-name   { flex: 1; font-size: 11px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shop-lvl    { font-size: 9px; color: #ff8844; }
  .shop-stock  { font-size: 9px; color: #88ccff; width: 46px; text-align: right; flex-shrink: 0; }
  .shop-stock.sold-out { color: #ff8844; }
  .shop-price  { font-size: 11px; color: #ffdd88; width: 46px; text-align: right; flex-shrink: 0; }
  .shop-act {
    flex-shrink: 0;
    width: 50px;
    background: #1a1a1a;
    border: 1px solid #666;
    color: #fff;
    font-family: monospace;
    font-size: 10px;
    padding: 3px 0;
    cursor: pointer;
  }
  .shop-act:hover:not(:disabled) { border-color: #aaa; background: #222; }
  .shop-act:disabled { opacity: 0.35; cursor: default; }
  .shop-empty { font-size: 11px; color: #444; padding: 10px 2px; }

  #shop-toast {
    margin-top: 8px;
    text-align: center;
    font-size: 10px;
    color: #88ffcc;
    min-height: 14px;
    opacity: 0;
    transition: opacity 0.3s;
  }
`
