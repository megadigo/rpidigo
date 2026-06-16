/**
 * VendorScene — player-run vendor stall UI.
 *
 * Owner view (local player's own house):
 *   Pick items from the personal storage chest, set a price, and create a
 *   listing.  Remove a listing to return unsold stock to the chest.  Collect
 *   accumulated sale proceeds (till) into the player's gold balance.
 *
 * Buyer view (visiting another player's house):
 *   Browse the owner's active listings and buy any quantity.  The listing
 *   quantity is decremented atomically via runTransaction to prevent oversell.
 */
import Phaser from 'phaser'
import { ref, get, update, runTransaction, remove, increment } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { getTile, setTile } from '../world/ChunkManager.ts'
import { tileKey } from '../world/utils.ts'
import { WeaponRegistry, ArmorRegistry, ItemRegistry } from '../registry/registries.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VendorSceneData {
  roomId:      string
  isOwner:     boolean
  /** Personal storage chest tile position — required for owner view. */
  chestTileX?: number
  chestTileY?: number
}

type Listing   = { id: string; itemId: string; quantity: number; price: number }
type ChestSlot = { itemId: string; quantity: number }

// ─── Scene ────────────────────────────────────────────────────────────────────

export class VendorScene extends Phaser.Scene {
  private _data!:          VendorSceneData
  private _ownerId:        string = ''
  private _listings:       Listing[]   = []
  private _chest:          ChestSlot[] = []
  private _till:           number = 0
  private _selectedChest:  number = -1   // index into _chest for listing form
  private _overlay:        HTMLDivElement   | null = null
  private _style:          HTMLStyleElement | null = null

  constructor() {
    super({ key: 'VendorScene' })
  }

  init(data: VendorSceneData): void {
    this._data          = data
    this._ownerId       = ''
    this._listings      = []
    this._chest         = []
    this._till          = 0
    this._selectedChest = -1
    if (data.isOwner) this._ownerId = getLocalPlayer().id
  }

  create(): void {
    if (this.input.keyboard)
      this.input.keyboard.once('keydown-ESC', () => this._close())
    this._buildOverlay()
    void this._loadThenRender()
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  private async _loadThenRender(): Promise<void> {
    if (!this._data.isOwner) {
      const snap = await get(ref(db, `houseOwners/${this._data.roomId}`))
      this._ownerId = snap.val() ?? ''
      if (!this._ownerId) { this._close(); return }
    }

    const vendorSnap = await get(ref(db, `players/${this._ownerId}/vendor`))
    const v          = vendorSnap.val() ?? {}
    this._till       = v.till ?? 0
    this._listings   = Object.entries(v.listings ?? {}).map(
      ([id, val]) => ({ id, ...(val as Omit<Listing, 'id'>) })
    )

    if (this._data.isOwner && this._data.chestTileX !== undefined) {
      const tile  = getTile(this._data.chestTileX, this._data.chestTileY!)
      this._chest = (tile?.metadata?.items ?? []).map((i: ChestSlot) => ({ ...i }))
    }

    this._render()
  }

  // ── DOM build ────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = VENDOR_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'vd-overlay'
    this._overlay.innerHTML = this._data.isOwner ? this._ownerShell() : this._buyerShell()
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#vd-close')?.addEventListener('click', () => this._close())
  }

  private _ownerShell(): string {
    return `
      <div id="vd-box">
        <div id="vd-header">
          <span id="vd-title">Your Vendor Stall</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="vd-till-row"></span>
            <span class="vd-hint">[Esc] close</span>
            <button id="vd-close">✕</button>
          </div>
        </div>
        <div id="vd-content">
          <div id="vd-listings-panel">
            <div class="vd-section-title">Active Listings</div>
            <div id="vd-listings"></div>
          </div>
          <div id="vd-chest-panel">
            <div class="vd-section-title">Storage Chest</div>
            <div id="vd-chest-grid"></div>
            <div id="vd-form"></div>
          </div>
        </div>
      </div>`
  }

  private _buyerShell(): string {
    return `
      <div id="vd-box">
        <div id="vd-header">
          <span id="vd-title">Vendor Stall</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="vd-gold-label"></span>
            <span class="vd-hint">[Esc] close</span>
            <button id="vd-close">✕</button>
          </div>
        </div>
        <div id="vd-listings-panel">
          <div id="vd-listings"></div>
        </div>
        <div id="vd-toast"></div>
      </div>`
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  private _render(): void {
    if (this._data.isOwner) {
      this._renderTill()
      this._renderOwnerListings()
      this._renderChest()
      this._renderForm()
    } else {
      this._renderBuyerGold()
      this._renderBuyerListings()
    }
  }

  private _renderTill(): void {
    const el = this._overlay?.querySelector('#vd-till-row')
    if (!el) return
    if (this._till > 0) {
      el.innerHTML = `<span class="vd-till">Till: <strong>${this._till}g</strong></span>
        <button id="vd-collect">Collect</button>`
      el.querySelector('#vd-collect')?.addEventListener('click', () => void this._collect())
    } else {
      el.innerHTML = '<span class="vd-till-empty">Till: 0g</span>'
    }
  }

  private _renderOwnerListings(): void {
    const el = this._overlay?.querySelector('#vd-listings')
    if (!el) return
    if (!this._listings.length) {
      el.innerHTML = '<div class="vd-empty">No active listings</div>'
      return
    }
    el.innerHTML = this._listings.map(l => `
      <div class="vd-listing-row" data-id="${l.id}">
        <canvas class="vd-icon" width="20" height="20"></canvas>
        <span class="vd-lname">${_esc(this._name(l.itemId))}</span>
        <span class="vd-lqty">×${l.quantity}</span>
        <span class="vd-lprice">${l.price}g</span>
        <button class="vd-remove" data-id="${l.id}">✕</button>
      </div>`).join('')

    this._listings.forEach(l => {
      const row = el.querySelector<HTMLElement>(`.vd-listing-row[data-id="${l.id}"]`)
      const c   = row?.querySelector<HTMLCanvasElement>('.vd-icon')
      if (c) this._drawIcon(c, l.itemId)
    })
    el.querySelectorAll<HTMLElement>('.vd-remove').forEach(btn =>
      btn.addEventListener('click', () => this._removeListing(btn.dataset.id!)))
  }

  private _renderChest(): void {
    const grid = this._overlay?.querySelector('#vd-chest-grid')
    if (!grid) return
    if (!this._chest.length) {
      grid.innerHTML = '<div class="vd-empty">Chest is empty</div>'
      return
    }
    grid.innerHTML = this._chest.map((s, i) => `
      <div class="vd-cell${this._selectedChest === i ? ' vd-selected' : ''}" data-i="${i}" title="${_esc(this._name(s.itemId))}">
        <canvas class="vd-icon" width="20" height="20"></canvas>
        ${s.quantity > 1 ? `<span class="vd-qty">${s.quantity}</span>` : ''}
      </div>`).join('')

    this._chest.forEach((s, i) => {
      const c = grid.querySelector<HTMLCanvasElement>(`.vd-cell[data-i="${i}"] .vd-icon`)
      if (c) this._drawIcon(c, s.itemId)
    })
    grid.querySelectorAll<HTMLElement>('.vd-cell').forEach(cell =>
      cell.addEventListener('click', () => {
        this._selectedChest = parseInt(cell.dataset.i!, 10)
        this._renderChest()
        this._renderForm()
      }))
  }

  private _renderForm(): void {
    const el = this._overlay?.querySelector('#vd-form')
    if (!el) return
    const slot = this._chest[this._selectedChest]
    if (!slot) { el.innerHTML = ''; return }

    el.innerHTML = `
      <div class="vd-form-box">
        <div class="vd-form-name">${_esc(this._name(slot.itemId))}</div>
        <label class="vd-form-label">Price per unit (g)
          <input id="vd-price-input" type="number" min="1" value="1" class="vd-input">
        </label>
        <label class="vd-form-label">Quantity (max ${slot.quantity})
          <input id="vd-qty-input" type="number" min="1" max="${slot.quantity}" value="1" class="vd-input">
        </label>
        <button id="vd-list-btn">List for sale</button>
      </div>`

    el.querySelector('#vd-list-btn')?.addEventListener('click', () => {
      const price = parseInt((el.querySelector('#vd-price-input') as HTMLInputElement)?.value ?? '1', 10)
      const qty   = parseInt((el.querySelector('#vd-qty-input')   as HTMLInputElement)?.value ?? '1', 10)
      this._list(this._selectedChest, price, qty)
    })
  }

  private _renderBuyerGold(): void {
    const el = this._overlay?.querySelector('#vd-gold-label')
    if (el) el.textContent = `Your gold: ${getLocalPlayer().gold ?? 0}g`
  }

  private _renderBuyerListings(): void {
    const el = this._overlay?.querySelector('#vd-listings')
    if (!el) return
    if (!this._listings.length) {
      el.innerHTML = '<div class="vd-empty">Nothing for sale here.</div>'
      return
    }
    el.innerHTML = `
      <div class="vd-buyer-header">
        <span>Item</span><span>Stock</span><span>Price</span><span>Qty</span><span></span>
      </div>` +
      this._listings.map(l => `
        <div class="vd-buyer-row" data-id="${l.id}">
          <span class="vd-buyer-item">
            <canvas class="vd-icon" width="20" height="20"></canvas>
            ${_esc(this._name(l.itemId))}
          </span>
          <span class="vd-buyer-stock">×${l.quantity}</span>
          <span class="vd-buyer-price">${l.price}g ea</span>
          <input class="vd-input vd-buy-qty" type="number" min="1" max="${l.quantity}" value="1">
          <button class="vd-buy-btn" data-id="${l.id}">Buy</button>
        </div>`).join('')

    this._listings.forEach(l => {
      const row = el.querySelector<HTMLElement>(`.vd-buyer-row[data-id="${l.id}"]`)
      const c   = row?.querySelector<HTMLCanvasElement>('.vd-icon')
      if (c) this._drawIcon(c, l.itemId)
    })
    el.querySelectorAll<HTMLElement>('.vd-buy-btn').forEach(btn => {
      const row     = btn.closest<HTMLElement>('.vd-buyer-row')!
      const qtyInput = row.querySelector<HTMLInputElement>('.vd-buy-qty')!
      btn.addEventListener('click', () => {
        const listing = this._listings.find(l => l.id === btn.dataset.id)
        if (!listing) return
        const qty = Math.max(1, Math.min(parseInt(qtyInput.value, 10) || 1, listing.quantity))
        void this._buy(listing, qty)
      })
    })
  }

  // ── Owner actions ─────────────────────────────────────────────────────────────

  private _list(chestIdx: number, price: number, qty: number): void {
    const slot = this._chest[chestIdx]
    if (!slot) return
    price = Math.max(1, Math.floor(price))
    qty   = Math.max(1, Math.min(Math.floor(qty), slot.quantity))

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    this._listings.push({ id, itemId: slot.itemId, quantity: qty, price })

    // Remove qty from chest slot
    slot.quantity -= qty
    if (slot.quantity <= 0) this._chest.splice(chestIdx, 1)
    this._selectedChest = -1

    this._persistChest()
    void update(ref(db), {
      [`players/${this._ownerId}/vendor/listings/${id}`]: {
        itemId: slot.itemId, quantity: qty, price,
      },
    })
    this._render()
  }

  private _removeListing(listingId: string): void {
    const idx     = this._listings.findIndex(l => l.id === listingId)
    if (idx === -1) return
    const listing = this._listings.splice(idx, 1)[0]

    // Return stock to chest
    const existing = this._chest.find(s => s.itemId === listing.itemId)
    if (existing) existing.quantity += listing.quantity
    else this._chest.push({ itemId: listing.itemId, quantity: listing.quantity })

    this._persistChest()
    void remove(ref(db, `players/${this._ownerId}/vendor/listings/${listingId}`))
    this._render()
  }

  private async _collect(): Promise<void> {
    if (this._till <= 0) return
    const player = getLocalPlayer()
    player.gold  = (player.gold ?? 0) + this._till
    setLocalPlayer(player)
    void update(ref(db), {
      [`players/${player.id}/gold`]:        player.gold,
      [`players/${player.id}/vendor/till`]: 0,
    })
    this._till = 0
    this._render()
  }

  // ── Buyer actions ─────────────────────────────────────────────────────────────

  private async _buy(listing: Listing, qty: number): Promise<void> {
    const player    = getLocalPlayer()
    const totalCost = listing.price * qty
    if ((player.gold ?? 0) < totalCost) {
      this._toast('Not enough gold.')
      return
    }

    const listingRef = ref(db, `players/${this._ownerId}/vendor/listings/${listing.id}`)
    const txResult   = await runTransaction(listingRef, (current: { itemId: string; quantity: number; price: number } | null) => {
      if (!current) return undefined
      if (current.quantity < qty) return undefined
      const newQty = current.quantity - qty
      return newQty === 0 ? null : { ...current, quantity: newQty }
    })

    if (!txResult.committed) {
      this._toast('Purchase failed — stock may have changed.')
      return
    }

    // Update buyer locally
    player.gold = (player.gold ?? 0) - totalCost
    const inv   = player.inventory ?? []
    const slot  = inv.find(s => s.itemId === listing.itemId)
    if (slot) slot.quantity += qty
    else inv.push({ itemId: listing.itemId, quantity: qty, metadata: {} })
    player.inventory = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/gold`]:             player.gold,
      [`players/${player.id}/inventory`]:        player.inventory,
      [`players/${this._ownerId}/vendor/till`]:  increment(totalCost),
    })

    // Update local listing state
    listing.quantity -= qty
    if (listing.quantity <= 0)
      this._listings = this._listings.filter(l => l.id !== listing.id)

    this._toast(`Bought ${qty}× ${this._name(listing.itemId)} for ${totalCost}g.`)
    this._render()
  }

  // ── Chest persistence ─────────────────────────────────────────────────────────

  private _persistChest(): void {
    const { chestTileX: cx, chestTileY: cy, roomId } = this._data
    if (cx === undefined || cy === undefined) return
    const tile = getTile(cx, cy)
    if (!tile) return
    const newTile = {
      ...tile,
      metadata: { ...(tile.metadata ?? {}), items: this._chest.filter(s => s.quantity > 0) },
    }
    setTile(cx, cy, newTile)
    void update(ref(db), {
      [`map/${roomId}/${tileKey(cx, cy)}`]: newTile,
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private _toast(msg: string): void {
    const el = this._overlay?.querySelector('#vd-toast')
    if (!el) return
    el.textContent = msg
    el.classList.add('vd-toast-show')
    setTimeout(() => el.classList.remove('vd-toast-show'), 2800)
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
        ctx.drawImage(src, 0, 0, 16, 16, 0, 0, 20, 20)
        return
      } catch { /* fall through */ }
    }

    const COLORS: Record<string, string> = {
      material: '#8b6914', consumable: '#c0392b', weapon: '#e67e22',
      tool: '#7f8c8d', armor: '#2980b9',
    }
    let cat = 'material'
    try {
      if (WeaponRegistry.has(itemId))     cat = 'weapon'
      else if (ArmorRegistry.has(itemId)) cat = 'armor'
      else if (ItemRegistry.has(itemId))  cat = ItemRegistry.get(itemId).category
    } catch { /* ignore */ }
    ctx.fillStyle = COLORS[cat] ?? '#555'
    ctx.fillRect(1, 1, 18, 18)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((itemId[0] ?? '?').toUpperCase(), 10, 11)
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

const VENDOR_CSS = `
  #vd-overlay {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
    background: rgba(0,0,0,0.6);
    font-family: monospace;
  }
  #vd-box {
    background: #111;
    border: 2px solid #555;
    border-radius: 3px;
    width: 520px; max-width: 96vw;
    padding: 14px 16px;
    color: #eee;
    box-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  #vd-header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px; margin-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  #vd-title { font-size: 13px; color: #ffdd88; letter-spacing: 0.1em; }
  .vd-hint  { font-size: 10px; color: #555; }
  #vd-close {
    background: transparent; border: 1px solid #444;
    color: #888; font-family: monospace; font-size: 10px;
    padding: 1px 7px; cursor: pointer; line-height: 1.4;
  }
  #vd-close:hover { border-color: #aaa; color: #fff; }
  #vd-collect {
    background: transparent; border: 1px solid #5a4a00;
    color: #ffdd88; font-family: monospace; font-size: 9px;
    padding: 1px 8px; cursor: pointer; line-height: 1.4;
  }
  #vd-collect:hover { border-color: #ffdd88; }
  .vd-till       { font-size: 11px; color: #ffdd88; margin-right: 4px; }
  .vd-till-empty { font-size: 11px; color: #444; }
  #vd-gold-label { font-size: 11px; color: #ffdd88; }

  #vd-content {
    display: flex; gap: 14px;
  }
  #vd-listings-panel {
    flex: 1; min-width: 0;
    border-right: 1px solid #222; padding-right: 14px;
  }
  #vd-chest-panel {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .vd-section-title {
    font-size: 9px; color: #666;
    letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;
  }
  .vd-empty { font-size: 11px; color: #333; padding: 6px 0; }

  #vd-listings { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
  .vd-listing-row {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px; background: #0d0d0d;
    border: 1px solid #222; border-radius: 2px;
    font-size: 11px;
  }
  .vd-lname  { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vd-lqty   { color: #aaa; font-size: 10px; }
  .vd-lprice { color: #ffdd88; font-size: 10px; width: 30px; text-align: right; }
  .vd-remove {
    background: transparent; border: 1px solid #333;
    color: #666; font-family: monospace; font-size: 9px;
    padding: 0 5px; cursor: pointer; line-height: 1.6;
  }
  .vd-remove:hover { border-color: #c0392b; color: #c0392b; }

  #vd-chest-grid {
    display: flex; flex-wrap: wrap; gap: 3px;
    align-content: flex-start;
    min-height: 60px; max-height: 140px; overflow-y: auto;
  }
  .vd-cell {
    width: 32px; height: 32px;
    border: 1px solid #252525; border-radius: 2px;
    position: relative; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background: #0d0d0d; flex-shrink: 0;
  }
  .vd-cell:hover   { border-color: #888; background: #1a1a1a; }
  .vd-selected     { border-color: #ffdd88 !important; background: #1a1500 !important; }
  .vd-icon         { image-rendering: pixelated; }
  .vd-qty {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 7px; color: #ffdd88;
    text-shadow: 1px 1px 0 #000; pointer-events: none; line-height: 1;
  }

  .vd-form-box {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px; background: #0a0a0a;
    border: 1px solid #2a2a00; border-radius: 2px;
  }
  .vd-form-name  { font-size: 11px; color: #ffdd88; margin-bottom: 2px; }
  .vd-form-label { font-size: 10px; color: #888; display: flex; flex-direction: column; gap: 2px; }
  .vd-input {
    background: #1a1a1a; border: 1px solid #333;
    color: #eee; font-family: monospace; font-size: 11px;
    padding: 2px 6px; width: 70px;
  }
  #vd-list-btn {
    background: transparent; border: 1px solid #555;
    color: #ccc; font-family: monospace; font-size: 10px;
    padding: 3px 10px; cursor: pointer; align-self: flex-start;
  }
  #vd-list-btn:hover { border-color: #ffdd88; color: #ffdd88; }

  /* Buyer layout */
  #vd-listings-panel { flex: unset; border-right: none; padding-right: 0; }
  .vd-buyer-header {
    display: grid; grid-template-columns: 1fr 60px 70px 60px 60px;
    gap: 6px; padding: 2px 6px; margin-bottom: 4px;
    font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.1em;
  }
  .vd-buyer-row {
    display: grid; grid-template-columns: 1fr 60px 70px 60px 60px;
    gap: 6px; align-items: center;
    padding: 5px 6px; background: #0d0d0d;
    border: 1px solid #222; border-radius: 2px;
  }
  .vd-buyer-item  { display: flex; align-items: center; gap: 5px; font-size: 11px; }
  .vd-buyer-stock { font-size: 10px; color: #aaa; }
  .vd-buyer-price { font-size: 10px; color: #ffdd88; }
  .vd-buy-qty     { width: 48px; }
  .vd-buy-btn {
    background: transparent; border: 1px solid #444;
    color: #aaa; font-family: monospace; font-size: 9px;
    padding: 2px 8px; cursor: pointer; white-space: nowrap;
  }
  .vd-buy-btn:hover { border-color: #ffdd88; color: #ffdd88; }

  #vd-toast {
    position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; border: 1px solid #444; border-radius: 2px;
    color: #ccc; font-size: 11px; padding: 5px 14px;
    opacity: 0; transition: opacity 0.2s; pointer-events: none; white-space: nowrap;
  }
  .vd-toast-show { opacity: 1 !important; }
`
