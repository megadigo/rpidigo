/**
 * HudScene — persistent overlay above GameScene.
 * Shows HP, MP, Gold, and player name.
 * Step 7: proximity chat panel — press Enter to focus input, Enter to send, Esc to close.
 */
import Phaser from 'phaser'
import { ref, onValue, push, remove } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import { xpForLevel } from '../world/utils.ts'
import { virtualInput } from '../input/VirtualInput.ts'
import type { PlayerInstance } from '../world/types.ts'

/** Chebyshev tile radius — messages outside this range are hidden. */
const CHAT_RANGE  = 15
/** Messages older than this are pruned from Firebase. */
const CHAT_TTL_MS = 5 * 60_000

interface ChatMsg {
  key: string
  sender: string
  text: string
  timestamp: number
  x: number
  y: number
  system?: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export class HudScene extends Phaser.Scene {
  private hpText!: Phaser.GameObjects.Text
  private mpText!: Phaser.GameObjects.Text
  private goldText!: Phaser.GameObjects.Text
  private xpText!: Phaser.GameObjects.Text
  private levelText!: Phaser.GameObjects.Text
  private posText!: Phaser.GameObjects.Text

  private _chatPanel!: HTMLDivElement
  private _chatLog!: HTMLDivElement
  private _chatInput!: HTMLInputElement
  private _chatStyle!: HTMLStyleElement

  private _chatRoom = ''
  private _chatUnsub: (() => void) | null = null
  private _messages: ChatMsg[] = []

  /** Unsubscribe for the /players/{id} stat listener (remote HP/MP/gold/etc.). */
  private _playerUnsub: (() => void) | null = null

  private _renderTimer = 0
  private _lastRenderX = -1
  private _lastRenderY = -1

  private _dpadWrap:  HTMLDivElement | null = null
  private _dpadStyle: HTMLStyleElement | null = null
  private _fsBtnEl:   HTMLButtonElement | null = null
  private _fsBtnStyle: HTMLStyleElement | null = null

  /** Bound Enter-key handler so it can be removed on shutdown. */
  private _enterHandler!: (e: KeyboardEvent) => void

  constructor() {
    super({ key: 'HudScene' })
  }

  create(): void {
    const style = { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }

    this.add.rectangle(0, 0, this.scale.width, 18, 0x000000, 0.7).setOrigin(0, 0).setDepth(100)

    const player = getLocalPlayer()
    this.add.text(6, 3, player.name, { ...style, color: '#ffdd88' }).setDepth(101)
    this.levelText = this.add.text(110, 3, '', { ...style, color: '#ccff88' }).setDepth(101)

    this.hpText   = this.add.text(160, 3, '', style).setDepth(101)
    this.mpText   = this.add.text(300, 3, '', style).setDepth(101)
    this.goldText = this.add.text(440, 3, '', style).setDepth(101)
    this.xpText   = this.add.text(560, 3, '', { ...style, color: '#aaddff' }).setDepth(101)
    this.posText  = this.add.text(this.scale.width - 6, this.scale.height - 4, '', { ...style, fontSize: '10px', color: '#aaaaaa' })
      .setOrigin(1, 1).setDepth(101)

    this._buildChatPanel()
    this._buildDpad()
    this._buildFullscreenBtn()
    this._subscribeChat(player.room)
    this._subscribePlayer(player.id)

    // Global Enter — focus the chat input when it is not already active
    this._enterHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      if (document.activeElement === this._chatInput) return
      e.preventDefault()
      this._chatInput.focus()
    }
    document.addEventListener('keydown', this._enterHandler)

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this._teardown())
  }

  update(_time: number, delta: number): void {
    this._refresh()

    // Re-subscribe when the player changes rooms
    const room = getLocalPlayer().room
    if (room !== this._chatRoom) this._subscribeChat(room)

    // Re-render when the player moves or every 2 s (proximity filter changes)
    this._renderTimer += delta
    const p = getLocalPlayer()
    if (this._renderTimer >= 2000 || p.x !== this._lastRenderX || p.y !== this._lastRenderY) {
      this._renderTimer = 0
      this._lastRenderX = p.x
      this._lastRenderY = p.y
      this._renderMessages()
    }

  }

  // ── Chat panel ────────────────────────────────────────────────────────────

  private _buildChatPanel(): void {
    this._chatStyle = document.createElement('style')
    this._chatStyle.textContent = `
      #chat-panel {
        position: fixed;
        bottom: 8px;
        left: 8px;
        width: 280px;
        font-family: monospace;
        font-size: 11px;
        z-index: 50;
        pointer-events: none;
      }
      #chat-log {
        max-height: 112px;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        gap: 1px;
        margin-bottom: 3px;
        scrollbar-width: none;
      }
      #chat-log > div {
        background: rgba(0,0,0,0.55);
        padding: 1px 4px;
        border-radius: 2px;
        color: #ddd;
        word-break: break-word;
        line-height: 1.4;
      }
      #chat-log .chat-name { color: #ffdd88; }
      #chat-log .chat-system { color: #88ccff; font-style: italic; }
      #chat-input {
        pointer-events: auto;
        width: 100%;
        box-sizing: border-box;
        background: rgba(0,0,0,0.6);
        border: 1px solid #333;
        color: #fff;
        font-family: monospace;
        font-size: 11px;
        padding: 2px 5px;
        outline: none;
        border-radius: 2px;
      }
      #chat-input:focus { border-color: #aaa; }
      #chat-input::placeholder { color: #444; }
    `
    document.head.appendChild(this._chatStyle)

    this._chatPanel = document.createElement('div')
    this._chatPanel.id = 'chat-panel'
    this._chatPanel.innerHTML = `
      <div id="chat-log"></div>
      <input id="chat-input" type="text" maxlength="120"
        placeholder="[Enter] to chat" autocomplete="off" spellcheck="false">
    `
    document.body.appendChild(this._chatPanel)

    this._chatLog   = document.getElementById('chat-log')   as HTMLDivElement
    this._chatInput = document.getElementById('chat-input') as HTMLInputElement

    this._chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
      // Always stop propagation so Phaser never sees keystrokes while typing
      e.stopPropagation()

      if (e.key === 'Enter') {
        const text = this._chatInput.value.trim()
        if (text) this._sendMessage(text)
        this._chatInput.value = ''
        this._chatInput.blur()
      } else if (e.key === 'Escape') {
        this._chatInput.value = ''
        this._chatInput.blur()
      }
    })
  }

  private _subscribeChat(room: string): void {
    if (this._chatUnsub) { this._chatUnsub(); this._chatUnsub = null }
    this._chatRoom = room
    this._messages = []

    this._chatUnsub = onValue(ref(db, `chat/${room}`), (snap) => {
      const now  = Date.now()
      const data = snap.val() as Record<string, Omit<ChatMsg, 'key'>> | null
      const fresh: ChatMsg[] = []

      if (data) {
        for (const [key, msg] of Object.entries(data)) {
          if (now - msg.timestamp > CHAT_TTL_MS) {
            void remove(ref(db, `chat/${room}/${key}`))
            continue
          }
          fresh.push({ key, ...msg })
        }
      }
      this._messages = fresh.sort((a, b) => a.timestamp - b.timestamp)
      this._renderMessages()
    })
  }

  private _sendMessage(text: string): void {
    const p = getLocalPlayer()
    void push(ref(db, `chat/${p.room}`), {
      sender: p.name,
      x: p.x,
      y: p.y,
      text,
      timestamp: Date.now(),
    })
  }

  private _renderMessages(): void {
    const p = getLocalPlayer()
    const visible = this._messages
      .filter(m => m.system || Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= CHAT_RANGE)
      .slice(-30)

    this._chatLog.innerHTML = visible.map(m =>
      m.system
        ? `<div class="chat-system">${esc(m.text)}</div>`
        : `<div><span class="chat-name">${esc(m.sender)}:</span> ${esc(m.text)}</div>`,
    ).join('')
    this._chatLog.scrollTop = this._chatLog.scrollHeight
  }

  // ── D-pad (mobile only) ───────────────────────────────────────────────────

  private _buildDpad(): void {
    this._dpadStyle = document.createElement('style')
    this._dpadStyle.textContent = `
      /* Full-screen transparent wrapper — children are positioned independently */
      #dpad {
        position: fixed; inset: 0;
        pointer-events: none;
        z-index: 60; user-select: none; -webkit-user-select: none;
      }

      /* Directional cross — bottom LEFT, above the compact chat panel */
      #dpad-dirs {
        position: absolute;
        bottom: clamp(80px, 18vh, 150px);
        left: clamp(8px, 2vw, 20px);
        display: grid;
        grid-template-columns: repeat(3, clamp(40px, 10vmin, 58px));
        grid-template-rows:    repeat(3, clamp(40px, 10vmin, 58px));
        gap: clamp(2px, 0.4vmin, 5px);
        pointer-events: auto; touch-action: none;
      }
      .dpad-empty { width: clamp(40px, 10vmin, 58px); height: clamp(40px, 10vmin, 58px); }
      #dpad-center { width: clamp(40px, 10vmin, 58px); height: clamp(40px, 10vmin, 58px); }

      /* Shared directional button style */
      .dpad-btn {
        width:  clamp(40px, 10vmin, 58px);
        height: clamp(40px, 10vmin, 58px);
        font-size: clamp(14px, 3.5vmin, 20px);
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; touch-action: none;
        transition: background 0.08s;
      }
      .dpad-btn.pressed { background: rgba(255,255,255,0.25); }

      /* Right-side button column — A (action) at bottom, I (inventory) above */
      #dpad-right-col {
        position: absolute;
        bottom: clamp(80px, 18vh, 150px);
        right: clamp(8px, 2vw, 20px);
        display: flex; flex-direction: column-reverse; align-items: center;
        gap: clamp(8px, 2vmin, 14px);
        pointer-events: auto; touch-action: none;
      }
      #dpad-action {
        width:  clamp(52px, 13vmin, 70px);
        height: clamp(52px, 13vmin, 70px);
        border-radius: 50%;
        background: rgba(255,220,80,0.15);
        border: 2px solid rgba(255,220,80,0.45);
        color: #ffdd44; font-family: monospace;
        font-size: clamp(16px, 4vmin, 22px); font-weight: bold;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; touch-action: none;
        transition: background 0.08s;
      }
      #dpad-action.pressed { background: rgba(255,220,80,0.4); }
      #dpad-inventory {
        width:  clamp(42px, 10vmin, 56px);
        height: clamp(42px, 10vmin, 56px);
        border-radius: 8px;
        background: rgba(100,180,255,0.1);
        border: 1px solid rgba(100,180,255,0.35);
        color: #88bbff; font-family: monospace;
        font-size: clamp(14px, 3.5vmin, 20px); font-weight: bold;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; touch-action: none;
        transition: background 0.08s;
      }
      #dpad-inventory.pressed { background: rgba(100,180,255,0.3); }

      /* Compact chat — always compact since controls are always visible */
      #chat-panel { width: clamp(120px, 28vw, 200px) !important; bottom: 8px !important; }
      #chat-log   { max-height: clamp(36px, 8vh, 60px) !important; font-size: 9px !important; }
      #chat-input { font-size: 9px !important; padding: 1px 4px !important; }
    `
    document.head.appendChild(this._dpadStyle)

    this._dpadWrap = document.createElement('div')
    this._dpadWrap.id = 'dpad'
    this._dpadWrap.innerHTML = `
      <div id="dpad-dirs">
        <div class="dpad-empty"></div>
        <button class="dpad-btn" id="dpad-up">▲</button>
        <div class="dpad-empty"></div>
        <button class="dpad-btn" id="dpad-left">◄</button>
        <div id="dpad-center"></div>
        <button class="dpad-btn" id="dpad-right">►</button>
        <div class="dpad-empty"></div>
        <button class="dpad-btn" id="dpad-down">▼</button>
        <div class="dpad-empty"></div>
      </div>
      <div id="dpad-right-col">
        <button id="dpad-action">A</button>
        <button id="dpad-inventory">I</button>
      </div>`
    document.body.appendChild(this._dpadWrap)

    // Wire directional + action buttons via virtualInput
    const bindings: Array<[string, keyof typeof virtualInput]> = [
      ['dpad-up', 'up'], ['dpad-down', 'down'],
      ['dpad-left', 'left'], ['dpad-right', 'right'],
      ['dpad-action', 'action'],
    ]
    for (const [id, key] of bindings) {
      const btn = this._dpadWrap.querySelector(`#${id}`) as HTMLElement
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId)
        btn.classList.add('pressed')
        virtualInput[key] = true
      })
      const release = () => { btn.classList.remove('pressed'); virtualInput[key] = false }
      btn.addEventListener('pointerup',     release)
      btn.addEventListener('pointercancel', release)
      btn.addEventListener('pointerleave',  release)
    }

    // Inventory button — emits a game event picked up by GameScene
    const invBtn = this._dpadWrap.querySelector('#dpad-inventory') as HTMLElement
    invBtn.addEventListener('pointerdown', (e) => {
      invBtn.setPointerCapture(e.pointerId)
      invBtn.classList.add('pressed')
    })
    invBtn.addEventListener('pointerup', () => {
      invBtn.classList.remove('pressed')
      this.game.events.emit('openInventory')
    })
    invBtn.addEventListener('pointercancel', () => invBtn.classList.remove('pressed'))

    // Chat compactness is driven by the #dpad CSS !important overrides above
  }

  private _buildFullscreenBtn(): void {
    this._fsBtnStyle = document.createElement('style')
    this._fsBtnStyle.textContent = `
      #hud-fs {
        position: fixed; top: 2px; right: 2px; z-index: 102;
        background: transparent; border: 1px solid rgba(255,255,255,0.25);
        color: rgba(255,255,255,0.5); font-family: monospace;
        font-size: 11px; padding: 0 5px; line-height: 16px;
        cursor: pointer; user-select: none;
      }
      #hud-fs:hover { border-color: #fff; color: #fff; }
    `
    document.head.appendChild(this._fsBtnStyle)

    this._fsBtnEl = document.createElement('button')
    this._fsBtnEl.id  = 'hud-fs'
    this._fsBtnEl.textContent = '⛶'
    this._fsBtnEl.title = 'Toggle fullscreen'
    document.body.appendChild(this._fsBtnEl)

    const update = () => {
      this._fsBtnEl!.textContent = document.fullscreenElement ? '⊡' : '⛶'
    }
    this._fsBtnEl.addEventListener('click', () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      }
    })
    document.addEventListener('fullscreenchange', update)
  }

  private _teardown(): void {
    document.removeEventListener('keydown', this._enterHandler)
    if (this._chatUnsub)   { this._chatUnsub();   this._chatUnsub   = null }
    if (this._playerUnsub) { this._playerUnsub(); this._playerUnsub = null }
    this._chatPanel?.remove()
    this._chatStyle?.remove()
    this._dpadWrap?.remove()
    this._dpadStyle?.remove()
    this._fsBtnEl?.remove()
    this._fsBtnStyle?.remove()
    // Release all virtual inputs so nothing stays stuck after scene teardown
    virtualInput.up = virtualInput.down = virtualInput.left = virtualInput.right = virtualInput.action = false
  }

  // ── Remote player stats ─────────────────────────────────────────────────────

  /**
   * Subscribe to /players/{id} so externally-driven changes (e.g. a healer on
   * another client writing HP/MP) are merged into the local player and shown in
   * the HUD. Only HUD-relevant stat fields are merged — position, room, and
   * inventory/equipment are left to the owning systems to avoid clobbering local
   * optimistic state.
   */
  private _subscribePlayer(id: string): void {
    if (this._playerUnsub) { this._playerUnsub(); this._playerUnsub = null }
    this._playerUnsub = onValue(ref(db, `players/${id}`), snap => {
      const data = snap.val() as Partial<PlayerInstance> | null
      if (!data) return
      const p = getLocalPlayer()
      if (typeof data.hp           === 'number') p.hp           = data.hp
      if (typeof data.mp           === 'number') p.mp           = data.mp
      if (typeof data.maxHp        === 'number') p.maxHp        = data.maxHp
      if (typeof data.maxMp        === 'number') p.maxMp        = data.maxMp
      if (typeof data.gold         === 'number') p.gold         = data.gold
      if (typeof data.xp           === 'number') p.xp           = data.xp
      if (typeof data.level        === 'number') p.level        = data.level
      if (typeof data.power        === 'number') p.power        = data.power
      if (typeof data.totalDefense === 'number') p.totalDefense = data.totalDefense
      setLocalPlayer(p)
      this._refresh()
    })
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  private _refresh(): void {
    const p = getLocalPlayer()
    this.hpText.setText(`HP ${p.hp}/${p.maxHp}`)
    this.mpText.setText(`MP ${p.mp}/${p.maxMp}`)
    this.goldText.setText(`Gold ${p.gold}`)
    this.xpText.setText(`XP ${p.xp}/${xpForLevel(p.level + 1)}`)
    this.levelText.setText(`Lv.${p.level}`)
    this.posText.setText(`${p.x},${p.y}`)
  }
}
