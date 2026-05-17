/**
 * HudScene — persistent overlay above GameScene.
 * Shows HP, MP, Gold, and player name.
 * Step 7: proximity chat panel — press Enter to focus input, Enter to send, Esc to close.
 */
import Phaser from 'phaser'
import { ref, onValue, push, remove } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer } from '../player/Auth.ts'

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

  private _renderTimer = 0
  private _lastRenderX = -1
  private _lastRenderY = -1

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
    this._subscribeChat(player.room)

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

  private _teardown(): void {
    document.removeEventListener('keydown', this._enterHandler)
    if (this._chatUnsub) { this._chatUnsub(); this._chatUnsub = null }
    this._chatPanel?.remove()
    this._chatStyle?.remove()
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  private _refresh(): void {
    const p = getLocalPlayer()
    this.hpText.setText(`HP ${p.hp}/${p.maxHp}`)
    this.mpText.setText(`MP ${p.mp}/${p.maxMp}`)
    this.goldText.setText(`Gold ${p.gold}`)
    this.xpText.setText(`XP ${p.xp}`)
    this.levelText.setText(`Lv.${p.level}`)
    this.posText.setText(`${p.x},${p.y}`)
  }
}
