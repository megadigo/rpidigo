/**
 * InstructionsScene — How to Play screen accessible from the title screen.
 * Uses DOM for layout. Sprites are drawn from their raw PNG files (frame 0,
 * 16×16 source → 32×32 display) using the HTML Canvas API so no Phaser
 * texture loading is required at this pre-login stage.
 */
import Phaser from 'phaser'

// Sprite paths relative to the public root
const S = (path: string) => `/assets/sprites/${path}`

// [canvas-id, sprite-path] pairs loaded after the DOM is built
type SpriteEntry = [string, string]

const SPRITES: SpriteEntry[] = [
  // Players
  ['sp-player',   S('Player/Arthax.png')],
  // Enemies
  ['sp-wolf',     S('Enemies/wolf.png')],
  ['sp-skeleton', S('Enemies/skeleton.png')],
  ['sp-slime',    S('Enemies/slime_weak.png')],
  // NPCs
  ['sp-healer',   S('NPCs/healer_standard.png')],
  ['sp-merchant', S('NPCs/merchant_standard.png')],
  ['sp-dog',      S('NPCs/dog.png')],
  ['sp-guard',    S('NPCs/guard_patrol.png')],
  // World
  ['sp-grass',    S('World/Ground/Grass.png')],
  ['sp-tree',     S('World/Nature/Trees.png')],
  ['sp-rock',     S('World/Nature/RocksBig.png')],
  ['sp-house',    S('World/Buildings/Huts.png')],
  ['sp-dungeon',  S('World/Buildings/DungeonEntrance.png')],
  // Items / furniture
  ['sp-workbench', S('House/WorkBench.png')],
  ['sp-chest',     S('House/Chest.png')],
]

export class InstructionsScene extends Phaser.Scene {
  private _overlay: HTMLDivElement | null = null
  private _style:   HTMLStyleElement | null = null

  constructor() {
    super({ key: 'InstructionsScene' })
  }

  create(): void {
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this._back())
    }
    this._buildOverlay()
    this._loadSprites()
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    this._style = document.createElement('style')
    this._style.textContent = HELP_CSS
    document.head.appendChild(this._style)

    this._overlay = document.createElement('div')
    this._overlay.id = 'help-overlay'
    this._overlay.innerHTML = `
      <div id="help-box">

        <div id="help-header">
          <span id="help-title">How to Play — DIGON</span>
          <button id="help-back">← Back</button>
        </div>

        <div id="help-body">

          <!-- Controls -->
          <div class="hs">
            <div class="hs-title">Controls</div>
            <div class="hs-row">
              <div class="hs-key-col">
                <div class="key-row"><kbd>↑ ↓ ← →</kbd></div>
                <div class="key-row"><kbd>A</kbd></div>
                <div class="key-row"><kbd>I</kbd></div>
                <div class="key-row"><kbd>Enter</kbd></div>
                <div class="key-row"><kbd>Esc</kbd></div>
              </div>
              <div class="hs-desc-col">
                <div>Move</div>
                <div><strong>Action</strong> — attack · interact · open · gather · talk</div>
                <div>Open inventory</div>
                <div>Open / send chat</div>
                <div>Close any overlay</div>
              </div>
            </div>
            <div class="hs-note">On mobile: D-pad directions on the left, <strong>A</strong> action button on the right. Zoom starts at 2× for easier play.</div>
          </div>

          <!-- World -->
          <div class="hs">
            <div class="hs-title">Exploring the World</div>
            <div class="hs-sprite-row">
              ${sp('sp-grass','Grass')}
              ${sp('sp-tree','Tree')}
              ${sp('sp-rock','Rock')}
              ${sp('sp-house','House')}
              ${sp('sp-dungeon','Dungeon')}
            </div>
            <p class="hs-p">
              The world is a 1000 × 1000 tile grid split into biomes — plains,
              forest, river, and desert — each with its own enemies and resources.
              Every sector contains a <strong>village</strong> and a <strong>dungeon entrance</strong>.
              Walk up to any building tile to automatically enter its interior.
            </p>
          </div>

          <!-- Combat -->
          <div class="hs">
            <div class="hs-title">Combat</div>
            <div class="hs-sprite-row">
              ${sp('sp-player','You')}
              ${sp('sp-wolf','Wolf')}
              ${sp('sp-skeleton','Skeleton')}
              ${sp('sp-slime','Slime')}
            </div>
            <p class="hs-p">
              Face an enemy and press <kbd>A</kbd> to attack. Each hit deals
              <em>power − enemy defense</em> damage (minimum 1).
              Killing enemies earns XP and drops loot.
              You have a short invincibility window after each hit you receive.
            </p>
            <p class="hs-p">
              <strong>PVP</strong> unlocks at level 10 — both players must be
              level 10 or above to attack each other.
            </p>
          </div>

          <!-- NPCs -->
          <div class="hs">
            <div class="hs-title">NPCs</div>
            <div class="hs-npc-grid">
              <div class="hs-npc">${sp('sp-healer','')}<div><strong>Healer</strong><br>Restores HP &amp; MP to full</div></div>
              <div class="hs-npc">${sp('sp-merchant','')}<div><strong>Merchant</strong><br>Buy and sell items</div></div>
              <div class="hs-npc">${sp('sp-guard','')}<div><strong>Guard</strong><br>Patrols the village</div></div>
              <div class="hs-npc">${sp('sp-dog','')}<div><strong>Dog</strong><br>Press <kbd>A</kbd> near it to make it follow you. Re-interact within 5 minutes to keep its attention.</div></div>
            </div>
          </div>

          <!-- Gathering & Crafting -->
          <div class="hs">
            <div class="hs-title">Gathering &amp; Crafting</div>
            <div class="hs-sprite-row">
              ${sp('sp-tree','Chop')}
              ${sp('sp-rock','Mine')}
              ${sp('sp-workbench','Workbench')}
              ${sp('sp-chest','Chest')}
            </div>
            <p class="hs-p">
              Stand adjacent to a resource tile and press <kbd>A</kbd> to gather.
              Trees give <em>wood</em>, rocks give <em>stone</em> (rare: iron ore),
              bushes give <em>fiber</em>, mushrooms give <em>mushroom</em>.
              Resources regenerate over time.
            </p>
            <p class="hs-p">
              Bring materials to a <strong>workbench</strong> (in your house or a
              workshop) and press <kbd>A</kbd> to craft weapons and tools.
              Higher-tier recipes unlock at higher player levels.
            </p>
            <p class="hs-p">
              <strong>Chests</strong> contain gold and items and can be opened by anyone.
              The chest in your personal house is your private storage.
              Navigate between multiple chests in a room using ◀ ▶.
            </p>
          </div>

          <!-- Death -->
          <div class="hs">
            <div class="hs-title">Death &amp; Respawn</div>
            <p class="hs-p">
              When your HP reaches 0, all carried items drop as a loot chest at
              your position. <strong>Gold is never lost.</strong>
              You respawn at your personal house with 50% HP.
              A chat hint will appear pointing in the compass direction of
              your lost belongings.
            </p>
          </div>

          <!-- Multiplayer -->
          <div class="hs">
            <div class="hs-title">Multiplayer</div>
            <p class="hs-p">
              Other players appear as real-time sprites in the shared overworld.
              Press <kbd>Enter</kbd> to open the chat and send a message —
              only players within 15 tiles can see it.
              NPC AI (patrol, chase, flee) is executed by the nearest online
              player's browser, so entities stay active as long as someone is nearby.
            </p>
          </div>

        </div><!-- /help-body -->
      </div><!-- /help-box -->
    `
    document.body.appendChild(this._overlay)
    document.getElementById('help-back')!.addEventListener('click', () => this._back())
  }

  private _loadSprites(): void {
    if (!this._overlay) return
    for (const [id, path] of SPRITES) {
      const canvas = this._overlay.querySelector<HTMLCanvasElement>(`#${id}`)
      if (!canvas) continue
      const img = new Image()
      img.onload = () => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)
      }
      img.src = path
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────────────

  private _back(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
    this.scene.start('IntroScene')
  }

  shutdown(): void {
    this._overlay?.remove()
    this._style?.remove()
    this._overlay = null
    this._style   = null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sp(id: string, label: string): string {
  return `<div class="hs-sprite">
    <canvas id="${id}" width="32" height="32"></canvas>
    ${label ? `<div class="hs-sprite-label">${label}</div>` : ''}
  </div>`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const HELP_CSS = `
  #help-overlay {
    position: fixed; inset: 0; z-index: 110;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.88);
    font-family: monospace;
  }
  #help-box {
    background: #0e0e0e;
    border: 1px solid #333;
    border-radius: 3px;
    width: 560px; max-width: 96vw;
    max-height: 90vh;
    display: flex; flex-direction: column;
    box-shadow: 0 8px 40px rgba(0,0,0,0.8);
    color: #ddd;
  }
  #help-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 18px; border-bottom: 1px solid #222; flex-shrink: 0;
  }
  #help-title { font-size: 13px; color: #ffdd88; letter-spacing: .1em; }
  #help-back {
    background: transparent; border: 1px solid #444;
    color: #aaa; font-family: monospace; font-size: 11px;
    padding: 2px 12px; cursor: pointer; line-height: 1.6;
  }
  #help-back:hover { border-color: #aaa; color: #fff; }
  #help-body {
    overflow-y: auto; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 20px;
    scrollbar-width: thin; scrollbar-color: #333 transparent;
  }

  .hs { display: flex; flex-direction: column; gap: 8px; }
  .hs-title {
    font-size: 10px; color: #ffdd88; letter-spacing: .14em;
    text-transform: uppercase; border-bottom: 1px solid #1a1a1a;
    padding-bottom: 4px;
  }
  .hs-p { font-size: 11px; line-height: 1.7; color: #bbb; margin: 0; }
  .hs-note { font-size: 10px; color: #666; font-style: italic; }

  /* Controls table */
  .hs-row { display: flex; gap: 16px; }
  .hs-key-col { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
  .hs-desc-col { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #bbb; }
  .hs-desc-col div { line-height: 1.6; }
  .key-row { font-size: 11px; color: #bbb; display: flex; gap: 4px; align-items: center; line-height: 1.6; }
  kbd {
    background: #1a1a1a; border: 1px solid #444; border-radius: 3px;
    padding: 0 5px; font-family: monospace; font-size: 10px; color: #eee;
    white-space: nowrap;
  }

  /* Sprite row */
  .hs-sprite-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .hs-sprite {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
  }
  .hs-sprite canvas { image-rendering: pixelated; border: 1px solid #1f1f1f; }
  .hs-sprite-label { font-size: 9px; color: #555; text-align: center; }

  /* NPC grid */
  .hs-npc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .hs-npc {
    display: flex; gap: 10px; align-items: flex-start;
    font-size: 11px; color: #bbb; line-height: 1.55;
  }
  .hs-npc canvas { flex-shrink: 0; image-rendering: pixelated; border: 1px solid #1f1f1f; }
`
