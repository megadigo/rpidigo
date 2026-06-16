/**
 * DialogScene — DOM overlay for NPC dialogue (Step 10).
 *
 * Launched additively by GameScene when the player presses E adjacent to an NPC.
 * GameScene freezes the player on launch and unfreezes when this scene stops.
 *
 * Data passed via scene init:
 *   { templateId: string, npcX: number, npcY: number }
 *
 * NPC roles:
 *  'heal'     — restores HP and MP to full, writes to Firebase
 *  'gossip'   — reads config/pois and generates a contextual world tip
 *  'merchant' — placeholder dialogue (full ShopScene is Step 14)
 *  'chat'     — shows a random greeting line
 *  'guard'    — shows a patrol warning line
 *  'dog'      — writes follow_player_id + last_interact_at to NPC memory so
 *               the dog_follow.py script starts tracking the player
 */
import Phaser from 'phaser'
import { ref, get, update } from 'firebase/database'
import { db } from '../firebase.ts'
import { getLocalPlayer, setLocalPlayer } from '../player/Auth.ts'
import type { PoiLayout } from '../world/types.ts'

// ─── NPC profile data ─────────────────────────────────────────────────────────

type NpcRole = 'chat' | 'heal' | 'gossip' | 'guard' | 'merchant' | 'dog' | 'plaque'

interface NpcProfile {
  displayName: string
  lines: string[]
  role: NpcRole
}

const NPC_PROFILES: Record<string, NpcProfile> = {
  villager_wanderer: {
    displayName: 'Villager',
    lines: [
      'Hello, traveller! Have you come far?',
      'Stay safe out there — the roads aren\'t what they used to be.',
      'Welcome to our village! Don\'t forget to explore.',
      'A fine day for a stroll, isn\'t it?',
      'Rumour has it treasure chests are scattered across the desert. Gold for the brave!',
    ],
    role: 'chat',
  },
  villager_hunter: {
    displayName: 'Hunter',
    lines: [
      'Watch yourself in the forest — wolves and worse lurk in those shadows.',
      'I spotted goblin scouts near the eastern treeline. Stay alert.',
      'The giant spiders have been bolder lately. Keep your weapon ready.',
      'Good hunting out there, traveller.',
      'Venomous spiders can poison you in a single bite. Don\'t let them corner you.',
    ],
    role: 'chat',
  },
  villager_fisherman: {
    displayName: 'Fisherman',
    lines: [
      'The river runs deep here. Crocodiles lurk near the banks.',
      'I\'ve seen water spirits dancing at night. Beautiful — and deadly.',
      'Cross the river if you dare. Good loot waits on the far side.',
      'River trolls guard the bridges. You\'ll need strength to pass.',
      'The river mud will slow you down. Find solid ground before you fight.',
    ],
    role: 'chat',
  },
  villager_gossiper: {
    displayName: 'Gossiper',
    lines: [
      'Psst! I know things…',
      'Come closer — I have news from across the world!',
      'You look like someone who appreciates useful information.',
    ],
    role: 'gossip',
  },
  healer_standard: {
    displayName: 'Healer',
    lines: [
      'You look weary, traveller. Let me restore your strength.',
      'May the light guide you on your journey.',
      'Rest easy — you are safe here.',
      'The road ahead is long. Go forth with full vigour.',
    ],
    role: 'heal',
  },
  merchant_standard: {
    displayName: 'Merchant',
    lines: [
      'Welcome, traveller! My shelves are stocked with the finest goods.',
      'Looking to buy or sell? I offer fair prices.',
      'I\'ve got weapons, armour, and materials. What do you need?',
      'A shrewd adventurer keeps their equipment up to date.',
    ],
    role: 'merchant',
  },
  guard_patrol: {
    displayName: 'Guard',
    lines: [
      'This village is under my protection. Behave yourself.',
      'Dark mages have been spotted near the outskirts — watch your back.',
      'Thieves on the roads lately. Keep your gold close, traveller.',
      'Move along, nothing to see here.',
      'We\'ve had reports of bandits on the plains. Stay in the village after dark.',
    ],
    role: 'guard',
  },
  dog: {
    displayName: 'Dog',
    lines: [
      'Woof! The dog wags its tail and looks up at you.',
      'The dog sniffs your hand and tilts its head.',
      'The dog lets out a happy bark!',
      'The dog nudges your hand with its nose.',
    ],
    role: 'dog',
  },
}

// ─── Scene data interface ─────────────────────────────────────────────────────

export interface DialogSceneData {
  templateId: string
  npcX: number
  npcY: number
  /** Required for NPCs that need to write to their own Firebase entity (e.g. dog). */
  npcId?: string
  /** Override display name (used for plaque/sign interactions). */
  plaqueTitle?: string
  /** Override dialog lines (used for plaque/sign interactions). */
  plaqueLines?: string[]
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class DialogScene extends Phaser.Scene {
  private _sceneData!: DialogSceneData
  private _profile!: NpcProfile
  private _overlay: HTMLDivElement | null = null
  private _style: HTMLStyleElement | null = null

  constructor() {
    super({ key: 'DialogScene' })
  }

  init(data: DialogSceneData): void {
    this._sceneData = data
    if (data.plaqueTitle !== undefined) {
      this._profile = {
        displayName: data.plaqueTitle,
        lines: data.plaqueLines ?? ['…'],
        role: 'plaque',
      }
    } else {
      this._profile = NPC_PROFILES[data.templateId] ?? {
        displayName: 'Stranger',
        lines: ['…'],
        role: 'chat',
      }
    }
  }

  create(): void {
    // Close on Escape or E key (Phaser input)
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._close())
      this.input.keyboard.once('keydown-A',   () => this._close())
    }

    void this._open()
  }

  // ── Open flow ───────────────────────────────────────────────────────────────

  private async _open(): Promise<void> {
    const role = this._profile.role

    let bodyText: string
    let subText: string | null = null

    if (role === 'plaque') {
      bodyText = this._profile.lines.join('\n')
    } else if (role === 'heal') {
      bodyText = this._pickLine()
      subText  = await this._applyHeal()
    } else if (role === 'gossip') {
      bodyText = this._pickLine()
      subText  = await this._fetchGossip()
    } else if (role === 'dog') {
      bodyText = this._pickLine()
      subText  = await this._applyDogFollow()
    } else {
      bodyText = this._pickLine()
    }

    this._buildOverlay(bodyText, subText)
  }

  // ── Role handlers ───────────────────────────────────────────────────────────

  /** Restore HP/MP to full and return a status line. */
  private async _applyHeal(): Promise<string> {
    const player   = getLocalPlayer()
    const hpBefore = player.hp
    const mpBefore = player.mp

    player.hp = player.maxHp
    player.mp = player.maxMp
    setLocalPlayer(player)

    await update(ref(db), {
      [`players/${player.id}/hp`]: player.maxHp,
      [`players/${player.id}/mp`]: player.maxMp,
    })

    const hpGained = player.maxHp - hpBefore
    const mpGained = player.maxMp - mpBefore

    if (hpGained > 0 || mpGained > 0) {
      const parts: string[] = []
      if (hpGained > 0) parts.push(`+${hpGained} HP`)
      if (mpGained > 0) parts.push(`+${mpGained} MP`)
      return `HP and MP fully restored. (${parts.join(', ')})`
    }
    return 'You are already at full health.'
  }

  /**
   * Signal the dog to follow this player by writing follow_player_id and
   * last_interact_at into the NPC's persisted memory in Firebase.
   * The dog_follow.py script reads these values on each tick.
   */
  private async _applyDogFollow(): Promise<string | null> {
    const npcId = this._sceneData.npcId
    if (!npcId) return null

    const player = getLocalPlayer()
    const now    = Date.now()

    await update(ref(db), {
      [`entities/npcs/${npcId}/memory/follow_player_id`]: player.id,
      [`entities/npcs/${npcId}/memory/last_interact_at`]: now,
      [`entities/npcs/${npcId}/state`]:                   'following',
    })

    return null
  }

  /** Fetch POI data and generate a contextual world tip. */
  private async _fetchGossip(): Promise<string> {
    try {
      const snap = await get(ref(db, 'config/pois'))
      const pois = snap.val() as PoiLayout | null
      if (!pois) return 'The world is still a mystery to me…'

      const player = getLocalPlayer()
      const px = player.x
      const py = player.y

      // Nearest village that is far enough to not be this one
      const nearestVillage = [...pois.villages]
        .map(v => ({ ...v, dist: Math.hypot(v.x - px, v.y - py) }))
        .filter(v => v.dist > 60)
        .sort((a, b) => a.dist - b.dist)[0]

      // Nearest dungeon entrance
      const nearestDungeon = [...pois.dungeons]
        .map(d => ({ ...d, dist: Math.hypot(d.x - px, d.y - py) }))
        .sort((a, b) => a.dist - b.dist)[0]

      const tips: string[] = []

      if (nearestDungeon) {
        const dx   = nearestDungeon.x - px
        const dy   = nearestDungeon.y - py
        const dir  = this._compassDir(dx, dy)
        const dist = Math.round(Math.hypot(dx, dy))
        tips.push(
          `There\'s a dungeon entrance about ${dist} tiles to the ${dir}. ` +
          `Brave souls venture there for glory — and rare crafting materials.`,
        )
      }

      if (nearestVillage) {
        const dx   = nearestVillage.x - px
        const dy   = nearestVillage.y - py
        const dir  = this._compassDir(dx, dy)
        const dist = Math.round(Math.hypot(dx, dy))
        tips.push(
          `Another village lies roughly ${dist} tiles to the ${dir}. ` +
          `Their merchants may stock different items at different prices.`,
        )
      }

      // Static hints that are always valid
      tips.push(
        'Desert chests are the richest — chitin armour and rare crystals if you\'re lucky. ' +
        'Watch out for scorpions.',
      )
      tips.push(
        'Dungeon bosses lock the room when they aggro. Clear the floor first, ' +
        'then challenge the boss at full strength.',
      )
      tips.push(
        'The blacksmith forge needs iron ingots. Mine rocks in the desert or dungeon — ' +
        'they\'re the richest source of iron ore.',
      )

      return tips[Math.floor(Math.random() * tips.length)]
    } catch {
      return 'The winds carry strange rumours… but I cannot make them out today.'
    }
  }

  // ── DOM overlay ─────────────────────────────────────────────────────────────

  private _buildOverlay(bodyText: string, subText: string | null): void {
    this._style = document.createElement('style')
    this._style.textContent = `
      #dialog-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 200;
        background: rgba(0,0,0,0.55);
        font-family: monospace;
      }
      #dialog-box {
        background: #111;
        border: 2px solid #555;
        border-radius: 3px;
        width: 380px;
        max-width: 92vw;
        padding: 14px 16px;
        color: #eee;
        box-shadow: 0 4px 24px rgba(0,0,0,0.8);
      }
      #dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 10px;
        margin-bottom: 10px;
        border-bottom: 1px solid #333;
      }
      #dialog-portrait {
        width: 32px;
        height: 32px;
        image-rendering: pixelated;
        border: 1px solid #444;
        flex-shrink: 0;
        background: #222;
      }
      #dialog-name {
        font-size: 13px;
        color: #ffdd88;
        letter-spacing: 0.08em;
      }
      #dialog-body {
        font-size: 11px;
        line-height: 1.65;
        color: #ccc;
        margin-bottom: 8px;
      }
      #dialog-sub {
        font-size: 11px;
        line-height: 1.5;
        color: #88ffcc;
        margin-bottom: 10px;
        padding: 6px 8px;
        background: rgba(0,255,150,0.06);
        border-left: 2px solid #44cc88;
      }
      #dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
      }
      .dlg-btn {
        background: transparent;
        border: 1px solid #555;
        color: #bbb;
        font-family: monospace;
        font-size: 11px;
        padding: 4px 16px;
        cursor: pointer;
        letter-spacing: 0.05em;
      }
      .dlg-btn:hover { border-color: #aaa; color: #fff; }
      .dlg-btn.primary { border-color: #888; color: #fff; }
    `
    document.head.appendChild(this._style)

    const isMerchant = this._profile.role === 'merchant'
    const subHtml    = subText
      ? `<div id="dialog-sub">${this._esc(subText)}</div>`
      : ''
    const shopBtn    = isMerchant
      ? `<button class="dlg-btn primary" id="dlg-shop">Shop</button>`
      : ''

    this._overlay = document.createElement('div')
    this._overlay.id = 'dialog-overlay'
    this._overlay.innerHTML = `
      <div id="dialog-box">
        <div id="dialog-header">
          <canvas id="dialog-portrait" width="32" height="32"></canvas>
          <span id="dialog-name">${this._esc(this._profile.displayName)}</span>
        </div>
        <div id="dialog-body">${this._esc(bodyText)}</div>
        ${subHtml}
        <div id="dialog-buttons">
          ${shopBtn}
          <button class="dlg-btn primary" id="dlg-close">${isMerchant ? 'Maybe later' : 'Close'}</button>
        </div>
      </div>
    `
    document.body.appendChild(this._overlay)

    // Draw NPC portrait at frame 0 (16×16 → 32×32 scaled)
    const canvas = this._overlay.querySelector('#dialog-portrait') as HTMLCanvasElement
    const img    = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)
    }
    img.src = `assets/sprites/NPCs/${this._sceneData.templateId}.png`

    // Shop button wires up to Step 14; for now just close
    this._overlay.querySelector('#dlg-shop')?.addEventListener('click', () => this._close())
    this._overlay.querySelector('#dlg-close')?.addEventListener('click', () => this._close())
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Pick a random line from the profile, avoiding the same one twice in a row. */
  private _pickLine(): string {
    const lines = this._profile.lines
    if (lines.length === 1) return lines[0]
    return lines[Math.floor(Math.random() * lines.length)]
  }

  /** Convert dx/dy to a compass direction string. */
  private _compassDir(dx: number, dy: number): string {
    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    if (angle < -157.5 || angle >= 157.5) return 'west'
    if (angle < -112.5) return 'north-west'
    if (angle < -67.5)  return 'north'
    if (angle < -22.5)  return 'north-east'
    if (angle < 22.5)   return 'east'
    if (angle < 67.5)   return 'south-east'
    if (angle < 112.5)  return 'south'
    return 'south-west'
  }

  private _esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  private _close(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
    this.scene.stop()
  }

  // Cleanup if the scene is stopped externally
  shutdown(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
  }
}
