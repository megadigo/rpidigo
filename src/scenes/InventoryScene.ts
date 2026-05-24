/**
 * InventoryScene — DOM overlay for inventory and equipment (Step 11).
 *
 * Launched additively by GameScene when the player presses I.
 * GameScene freezes the player on launch and unfreezes when this scene stops.
 *
 * Layout:
 *   Left panel  — equipment slots (weapon + 5 armor pieces) + ATK/DEF summary
 *   Right panel — item grid with pixel icons, stack counts, hover tooltip
 *
 * Actions:
 *   Click inventory item   → equip (weapon/armor) or use (consumable)
 *   Click equipped slot    → unequip back to inventory
 *   I / Esc                → close
 */
import Phaser from 'phaser'
import { ref, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { WeaponRegistry, ArmorRegistry, ItemRegistry } from '../registry/registries.ts'

// ─── Types & constants ────────────────────────────────────────────────────────

type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots' | 'gloves'

const ARMOR_SLOTS: ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots', 'gloves']
const SLOT_LABEL: Record<ArmorSlot, string> = {
  helmet:     'Helmet',
  chestplate: 'Chest',
  leggings:   'Legs',
  boots:      'Boots',
  gloves:     'Gloves',
}

interface ConsumableEffect {
  fn: (hp: number, maxHp: number, mp: number, maxMp: number) => { hp: number; mp: number }
  desc: string
}

const CONSUMABLE_FX: Record<string, ConsumableEffect> = {
  health_potion:   { fn: (hp, maxHp, mp, _maxMp) => ({ hp: Math.min(maxHp, hp + Math.max(20, Math.floor(maxHp * 0.4))), mp }), desc: 'Restores 40% HP'       },
  mana_potion:     { fn: (hp, _maxHp, mp, maxMp)  => ({ hp, mp: Math.min(maxMp, mp + Math.max(15, Math.floor(maxMp * 0.4))) }),  desc: 'Restores 40% MP'       },
  antidote:        { fn: (hp, maxHp, mp)           => ({ hp: Math.min(maxHp, hp + 10), mp }),                                    desc: 'Restores 10 HP'         },
  cooked_mushroom: { fn: (hp, maxHp, mp)           => ({ hp: Math.min(maxHp, hp + 20), mp }),                                    desc: 'Restores 20 HP'         },
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class InventoryScene extends Phaser.Scene {
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null
  private _toastTimer = 0

  constructor() {
    super({ key: 'InventoryScene' })
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
      this.input.keyboard.once('keydown-I',   () => this._close())
    }
    this._buildOverlay()
  }

  // ── Build DOM ────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = INV_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'inv-overlay'
    this._overlay.innerHTML = `
      <div id="inv-box">
        <div id="inv-header">
          <span id="inv-title">INVENTORY</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span id="inv-hint">[I] / [Esc] close</span>
            <button id="inv-close">✕</button>
          </div>
        </div>
        <div id="inv-content">
          <div id="inv-equip">
            <div class="inv-section-title">Equipment</div>
            <div id="equip-slots"></div>
            <div id="inv-stats">ATK —  DEF —</div>
          </div>
          <div id="inv-bag">
            <div class="inv-section-title">Backpack</div>
            <div id="inv-grid"></div>
            <div id="inv-tooltip"></div>
            <div id="inv-toast"></div>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(this._overlay)

    this._overlay.querySelector('#inv-close')?.addEventListener('click', () => this._close())
    this._renderAll()
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  private _renderAll(): void {
    this._renderEquipPanel()
    this._renderBagPanel()
    this._updateStats()
  }

  private _renderEquipPanel(): void {
    const player = getLocalPlayer()
    // Normalise fields absent on legacy accounts
    player.equippedArmor ??= { helmet: null, chestplate: null, leggings: null, boots: null, gloves: null }
    player.inventory     ??= []
    const box = this._overlay?.querySelector('#equip-slots')
    if (!box) return

    const wId = player.equippedWeapon

    const weaponHtml = `
      <div class="eq-slot" data-slot="weapon">
        <span class="eq-label">Weapon</span>
        <canvas class="eq-icon" width="24" height="24"></canvas>
        <span class="eq-name">${wId ? this._itemName(wId) : '—'}</span>
      </div>`

    const armorHtml = ARMOR_SLOTS.map(slot => {
      const aId = player.equippedArmor[slot]
      return `
        <div class="eq-slot" data-slot="${slot}">
          <span class="eq-label">${SLOT_LABEL[slot]}</span>
          <canvas class="eq-icon" width="24" height="24"></canvas>
          <span class="eq-name">${aId ? this._itemName(aId) : '—'}</span>
        </div>`
    }).join('')

    box.innerHTML = weaponHtml + armorHtml

    // Draw equipped item icons
    if (wId) this._drawIcon(box.querySelector<HTMLCanvasElement>('.eq-slot[data-slot="weapon"] .eq-icon'), wId)
    for (const slot of ARMOR_SLOTS) {
      const aId = player.equippedArmor[slot]
      if (aId) this._drawIcon(box.querySelector<HTMLCanvasElement>(`.eq-slot[data-slot="${slot}"] .eq-icon`), aId)
    }

    // Unequip on click
    box.querySelectorAll<HTMLElement>('.eq-slot').forEach(el => {
      el.addEventListener('click', () => {
        const slot = el.dataset.slot
        if (slot === 'weapon') this._unequipWeapon()
        else if (slot) this._unequipArmor(slot as ArmorSlot)
      })
    })
  }

  private _renderBagPanel(): void {
    const player = getLocalPlayer()
    const grid    = this._overlay?.querySelector('#inv-grid')
    const tooltip = this._overlay?.querySelector<HTMLElement>('#inv-tooltip')
    if (!grid) return

    const inv = player.inventory ?? []
    if (!inv.length) {
      grid.innerHTML = '<div class="inv-empty">Your backpack is empty.</div>'
      return
    }

    grid.innerHTML = inv.map((slot, idx) => `
      <div class="inv-cell" data-idx="${idx}">
        <canvas class="inv-icon" width="24" height="24"></canvas>
        ${slot.quantity > 1 ? `<span class="inv-qty">${slot.quantity}</span>` : ''}
      </div>
    `).join('')

    // Draw item icons
    inv.forEach((slot, idx) => {
      const canvas = grid.querySelector<HTMLCanvasElement>(`.inv-cell[data-idx="${idx}"] .inv-icon`)
      if (canvas) this._drawIcon(canvas, slot.itemId)
    })

    // Tooltip + click
    grid.querySelectorAll<HTMLElement>('.inv-cell').forEach(cell => {
      const idx = parseInt(cell.dataset.idx ?? '0', 10)
      const slot = inv[idx]
      if (!slot) return

      cell.addEventListener('mouseenter', () => {
        if (tooltip) {
          tooltip.innerHTML = this._makeTooltip(slot.itemId, slot.quantity)
          tooltip.style.display = 'block'
        }
      })
      cell.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.style.display = 'none'
      })
      cell.addEventListener('click', () => this._useOrEquip(idx))
    })
  }

  private _updateStats(): void {
    const p  = getLocalPlayer()
    const el = this._overlay?.querySelector('#inv-stats')
    if (el) el.textContent = `ATK ${p.power}  DEF ${p.totalDefense}`
  }

  // ── Item actions ─────────────────────────────────────────────────────────────

  private _useOrEquip(invIdx: number): void {
    const player = getLocalPlayer()
    const slot   = player.inventory?.[invIdx]
    if (!slot) return

    if (WeaponRegistry.has(slot.itemId)) { this._equipWeapon(invIdx); return }
    if (ArmorRegistry.has(slot.itemId))  { this._equipArmor(invIdx);  return }
    if (CONSUMABLE_FX[slot.itemId])      { this._useConsumable(invIdx); return }
  }

  private _equipWeapon(invIdx: number): void {
    const player  = getLocalPlayer()
    const newId   = player.inventory[invIdx].itemId
    const def     = WeaponRegistry.get(newId)

    if (player.level < def.levelRequired) {
      this._showToast(`Requires level ${def.levelRequired}`)
      return
    }

    // Remove new weapon from bag
    const inv = player.inventory.filter((_, i) => i !== invIdx)

    // Return old weapon to bag
    if (player.equippedWeapon) {
      try {
        const old = WeaponRegistry.get(player.equippedWeapon)
        player.power -= old.power
      } catch { /* unknown */ }
      inv.push({ itemId: player.equippedWeapon, quantity: 1, metadata: {} })
    }

    player.equippedWeapon = newId
    player.power         += def.power
    player.inventory      = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/equippedWeapon`]: newId,
      [`players/${player.id}/power`]:          player.power,
      [`players/${player.id}/inventory`]:      inv,
    })
    this._renderAll()
  }

  private _unequipWeapon(): void {
    const player = getLocalPlayer()
    if (!player.equippedWeapon) return

    try {
      const old = WeaponRegistry.get(player.equippedWeapon)
      player.power -= old.power
    } catch { /* ignore */ }

    const inv = [...(player.inventory ?? []), { itemId: player.equippedWeapon, quantity: 1, metadata: {} }]
    player.equippedWeapon = null
    player.inventory      = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/equippedWeapon`]: null,
      [`players/${player.id}/power`]:          player.power,
      [`players/${player.id}/inventory`]:      inv,
    })
    this._renderAll()
  }

  private _equipArmor(invIdx: number): void {
    const player  = getLocalPlayer()
    player.equippedArmor ??= { helmet: null, chestplate: null, leggings: null, boots: null, gloves: null }
    const newId   = player.inventory[invIdx].itemId
    const def     = ArmorRegistry.get(newId)
    const slot    = def.armorSlot

    if (player.level < def.levelRequired) {
      this._showToast(`Requires level ${def.levelRequired}`)
      return
    }

    const inv = player.inventory.filter((_, i) => i !== invIdx)

    // Return old armor piece to bag
    const oldId = player.equippedArmor[slot]
    if (oldId) {
      try {
        const old = ArmorRegistry.get(oldId)
        player.totalDefense -= old.defense
      } catch { /* ignore */ }
      inv.push({ itemId: oldId, quantity: 1, metadata: {} })
    }

    player.equippedArmor[slot] = newId
    player.totalDefense       += def.defense
    player.inventory           = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/equippedArmor/${slot}`]: newId,
      [`players/${player.id}/totalDefense`]:          player.totalDefense,
      [`players/${player.id}/inventory`]:             inv,
    })
    this._renderAll()
  }

  private _unequipArmor(slot: ArmorSlot): void {
    const player = getLocalPlayer()
    player.equippedArmor ??= { helmet: null, chestplate: null, leggings: null, boots: null, gloves: null }
    const id     = player.equippedArmor[slot]
    if (!id) return

    try {
      const def = ArmorRegistry.get(id)
      player.totalDefense -= def.defense
    } catch { /* ignore */ }

    const inv = [...(player.inventory ?? []), { itemId: id, quantity: 1, metadata: {} }]
    player.equippedArmor[slot] = null
    player.inventory           = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/equippedArmor/${slot}`]: null,
      [`players/${player.id}/totalDefense`]:          player.totalDefense,
      [`players/${player.id}/inventory`]:             inv,
    })
    this._renderAll()
  }

  private _useConsumable(invIdx: number): void {
    const player = getLocalPlayer()
    const slot   = player.inventory[invIdx]
    const fx     = CONSUMABLE_FX[slot.itemId]
    if (!fx) return

    const { hp, mp } = fx.fn(player.hp, player.maxHp, player.mp, player.maxMp)
    const hpGain = hp - player.hp
    const mpGain = mp - player.mp

    player.hp = hp
    player.mp = mp

    const inv = [...player.inventory]
    if (slot.quantity > 1) {
      inv[invIdx] = { ...slot, quantity: slot.quantity - 1 }
    } else {
      inv.splice(invIdx, 1)
    }
    player.inventory = inv
    setLocalPlayer(player)

    void update(ref(db), {
      [`players/${player.id}/hp`]:        hp,
      [`players/${player.id}/mp`]:        mp,
      [`players/${player.id}/inventory`]: inv,
    })

    const parts: string[] = []
    if (hpGain > 0) parts.push(`+${hpGain} HP`)
    if (mpGain > 0) parts.push(`+${mpGain} MP`)
    this._showToast(parts.length ? parts.join('  ') : 'Already at full.')
    this._renderAll()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Draw a 24×24 pixel-art icon onto a canvas by loading the item sprite image.
   * Assumes sprites live at assets/sprites/Items/{spriteFrame}.
   * Silently no-ops if the image 404s.
   */
  private _drawIcon(canvas: HTMLCanvasElement | null, itemId: string): void {
    if (!canvas) return
    let frame = itemId + '.png'
    try {
      if (WeaponRegistry.has(itemId))     frame = WeaponRegistry.get(itemId).spriteFrame
      else if (ArmorRegistry.has(itemId)) frame = ArmorRegistry.get(itemId).spriteFrame
      else if (ItemRegistry.has(itemId))  frame = ItemRegistry.get(itemId).spriteFrame
    } catch { /* ignore */ }

    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 24, 24)
    }
    img.src = `assets/sprites/Items/${frame}`
  }

  private _itemName(id: string): string {
    try {
      if (WeaponRegistry.has(id)) return WeaponRegistry.get(id).name
      if (ArmorRegistry.has(id))  return ArmorRegistry.get(id).name
      if (ItemRegistry.has(id))   return ItemRegistry.get(id).name
    } catch { /* ignore */ }
    return id
  }

  private _makeTooltip(itemId: string, qty: number): string {
    const name = this._itemName(itemId)
    let html = `<b>${_esc(name)}</b>`
    if (qty > 1) html += ` <span style="color:#aaa">×${qty}</span>`

    try {
      if (WeaponRegistry.has(itemId)) {
        const d = WeaponRegistry.get(itemId)
        html += `<br>ATK +${d.power} &nbsp;[${d.weaponType}]`
        if (d.mpCostPerSwing) html += `<br>MP cost: ${d.mpCostPerSwing}/swing`
        if (d.specialEffect)  html += `<br><span style="color:#ffdd88">✦ ${d.specialEffect}</span>`
        if (d.levelRequired > 1) html += `<br><span style="color:#ff8844">Lv.${d.levelRequired}+</span>`
        html += '<br><span style="color:#666">Click to equip</span>'

      } else if (ArmorRegistry.has(itemId)) {
        const d = ArmorRegistry.get(itemId)
        html += `<br>DEF +${d.defense} &nbsp;[${d.armorSlot}]`
        if (d.specialEffect) html += `<br><span style="color:#ffdd88">✦ ${d.specialEffect}</span>`
        if (d.levelRequired > 1) html += `<br><span style="color:#ff8844">Lv.${d.levelRequired}+</span>`
        html += '<br><span style="color:#666">Click to equip</span>'

      } else if (CONSUMABLE_FX[itemId]) {
        html += `<br>${CONSUMABLE_FX[itemId].desc}`
        html += '<br><span style="color:#666">Click to use</span>'

      } else {
        html += '<br><span style="color:#666">Crafting material</span>'
      }
    } catch { /* ignore */ }

    return html
  }

  private _showToast(msg: string): void {
    const toast = this._overlay?.querySelector<HTMLElement>('#inv-toast')
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

const INV_CSS = `
  #inv-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    background: rgba(0,0,0,0.6);
    font-family: monospace;
  }
  #inv-box {
    background: #111;
    border: 2px solid #555;
    border-radius: 3px;
    width: 520px;
    max-width: 96vw;
    padding: 14px 16px;
    color: #eee;
    box-shadow: 0 4px 24px rgba(0,0,0,0.8);
  }
  #inv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  #inv-title { font-size: 13px; color: #ffdd88; letter-spacing: 0.1em; }
  #inv-hint  { font-size: 10px; color: #555; }
  #inv-close {
    background: transparent;
    border: 1px solid #444;
    color: #888;
    font-family: monospace;
    font-size: 10px;
    padding: 1px 7px;
    cursor: pointer;
    line-height: 1.4;
  }
  #inv-close:hover { border-color: #aaa; color: #fff; }
  #inv-content { display: flex; gap: 14px; min-height: 220px; }

  /* ── Equipment panel ── */
  #inv-equip {
    width: 170px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }
  .inv-section-title {
    font-size: 9px;
    color: #666;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  #equip-slots { flex: 1; }
  .eq-slot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 5px;
    border: 1px solid #222;
    margin-bottom: 3px;
    cursor: pointer;
    border-radius: 2px;
    min-height: 30px;
  }
  .eq-slot:hover { border-color: #555; background: #1a1a1a; }
  .eq-label { font-size: 9px; color: #666; width: 40px; flex-shrink: 0; }
  .eq-icon  { image-rendering: pixelated; flex-shrink: 0; }
  .eq-name  {
    font-size: 10px; color: #ccc;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #inv-stats {
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid #222;
    font-size: 10px;
    color: #88ccff;
    letter-spacing: 0.05em;
  }

  /* ── Bag panel ── */
  #inv-bag {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  #inv-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-content: flex-start;
    flex: 1;
  }
  .inv-cell {
    width: 36px;
    height: 36px;
    border: 1px solid #252525;
    border-radius: 2px;
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d0d;
    flex-shrink: 0;
  }
  .inv-cell:hover { border-color: #666; background: #1a1a1a; }
  .inv-icon { image-rendering: pixelated; }
  .inv-qty {
    position: absolute;
    bottom: 1px; right: 2px;
    font-size: 8px;
    color: #ffdd88;
    text-shadow: 1px 1px 0 #000;
    pointer-events: none;
    line-height: 1;
  }
  .inv-empty { font-size: 11px; color: #444; padding: 8px 0; }

  /* ── Tooltip ── */
  #inv-tooltip {
    display: none;
    margin-top: 6px;
    font-size: 10px;
    line-height: 1.55;
    color: #ccc;
    background: rgba(0,0,0,0.65);
    border: 1px solid #333;
    border-radius: 2px;
    padding: 5px 8px;
    min-height: 38px;
  }

  /* ── Toast ── */
  #inv-toast {
    margin-top: 6px;
    text-align: center;
    font-size: 10px;
    color: #44ff88;
    min-height: 14px;
    opacity: 0;
    transition: opacity 0.3s;
  }
`
