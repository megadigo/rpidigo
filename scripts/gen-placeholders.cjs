/**
 * gen-placeholders.cjs
 * Generates placeholder PNG files for every sprite the game expects but
 * that is either missing entirely or currently shared with another tile.
 *
 * Run once:  node scripts/gen-placeholders.cjs
 *
 * 16×16  — item icons, single tile sprites
 * 80×128 — entity spritesheets (5 frames × 8 rows: walk↓↑→← + attack↓↑→←)
 */

'use strict'
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

const SPRITES = path.join(__dirname, '..', 'public', 'assets', 'sprites')

// ── PNG helpers ──────────────────────────────────────────────────────────────

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length)
  const r = Buffer.alloc(4); r.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([l, t, data, r])
}

/**
 * Create a W×H RGBA PNG.
 * `fill(x, y)` returns [r, g, b, a] for each pixel.
 */
function makePNG(w, h, fill) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = (() => {
    const d = Buffer.alloc(13)
    d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4)
    d[8] = 8; d[9] = 6 // RGBA
    return chunk('IHDR', d)
  })()
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0 // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y)
      const o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = r; raw[o+1] = g; raw[o+2] = b; raw[o+3] = a
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw))
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdr, idat, iend])
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

/** Parse '#rrggbb' → [r,g,b] */
function hex(s) {
  const v = parseInt(s.slice(1), 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/**
 * 16×16 icon placeholder.
 * Solid `bg` fill, 1-px `border` outline, small 2×2 px centre dot in `dot`.
 */
function icon16(bgHex, borderHex = '#000000', dotHex = '#ffffff') {
  const [br, bg_, bb] = hex(bgHex)
  const [or, og, ob]  = hex(borderHex)
  const [dr, dg, db]  = hex(dotHex)
  return makePNG(16, 16, (x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15
    const dot    = (x === 7 || x === 8) && (y === 7 || y === 8)
    if (border) return [or, og, ob, 255]
    if (dot)    return [dr, dg, db, 255]
    return [br, bg_, bb, 255]
  })
}

/**
 * 80×128 entity spritesheet placeholder.
 * 8 rows × 5 columns of 16×16 frames.
 * Rows 0-3 = walk (down/up/right/left) — lighter tint.
 * Rows 4-7 = attack (down/up/right/left) — darker tint.
 * Each frame gets a thin 1-px white inner grid line so you can see frame
 * boundaries when editing.
 */
function sheet(bgHex) {
  const [r, g, b] = hex(bgHex)
  const COLS = 5, ROWS = 8, F = 16
  return makePNG(COLS * F, ROWS * F, (x, y) => {
    const col  = Math.floor(x / F)
    const row  = Math.floor(y / F)
    const lx   = x % F, ly = y % F
    // grid lines
    const grid = lx === 0 || ly === 0
    if (grid) return [255, 255, 255, 80]
    // attack rows slightly darker
    const dark = row >= 4 ? 0.6 : 1.0
    // first frame of each direction gets a small centre dot
    const dot  = col === 0 && lx >= 6 && lx <= 9 && ly >= 6 && ly <= 9
    if (dot) return [255, 255, 255, 200]
    return [Math.round(r * dark), Math.round(g * dark), Math.round(b * dark), 255]
  })
}

// ── Write helper ─────────────────────────────────────────────────────────────

function write(relPath, buf) {
  const full = path.join(SPRITES, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  if (fs.existsSync(full)) {
    console.log(`  skip  ${relPath}  (already exists)`)
    return
  }
  fs.writeFileSync(full, buf)
  console.log(`  wrote ${relPath}`)
}

/** Same as write() but always overwrites — used for entity sheets that need
 *  to be the right dimensions even if a single-frame placeholder existed. */
function overwrite(relPath, buf) {
  const full = path.join(SPRITES, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buf)
  console.log(`  wrote ${relPath}  (entity sheet 80×128)`)
}

// ── Generate ─────────────────────────────────────────────────────────────────

console.log('\n=== Items (16×16) ===')
const ITEMS = [
  // materials
  ['Items/wood.png',          '#8B5E3C'],
  ['Items/stone.png',         '#8E8E8E'],
  ['Items/iron_ore.png',      '#A0522D'],
  ['Items/iron_bar.png',      '#708090'],
  ['Items/leather.png',       '#8B4513'],
  ['Items/gold_coin.png',     '#FFD700'],
  ['Items/mushroom.png',      '#C0392B'],
  // consumables
  ['Items/health_potion.png', '#E74C3C'],
  ['Items/mana_potion.png',   '#3498DB'],
  ['Items/antidote.png',      '#2ECC71'],
  ['Items/cooked_mushroom.png','#E67E22'],
  // tools
  ['Items/axe.png',           '#7F8C8D'],
  ['Items/pickaxe.png',       '#95A5A6'],
  ['Items/scythe.png',        '#AAB7B8'],
  // key
  ['Items/dungeon_key.png',   '#F1C40F'],
  // weapons
  ['Items/wooden_sword.png',  '#D4AC6E'],
  ['Items/iron_sword.png',    '#5D6D7E'],
  ['Items/iron_axe.png',      '#5D6D7E'],
  ['Items/shadow_blade.png',  '#6C3483'],
  ['Items/wooden_bow.png',    '#BA8C63'],
  ['Items/iron_bow.png',      '#5D6D7E'],
  ['Items/oak_staff.png',     '#7D6608'],
  ['Items/iron_staff.png',    '#1A5276'],
  // armor — leather
  ['Items/leather_helmet.png',     '#935116'],
  ['Items/leather_chestplate.png', '#935116'],
  ['Items/leather_leggings.png',   '#935116'],
  ['Items/leather_boots.png',      '#935116'],
  ['Items/leather_gloves.png',     '#935116'],
  // armor — iron
  ['Items/iron_helmet.png',     '#5D6D7E'],
  ['Items/iron_chestplate.png', '#5D6D7E'],
  ['Items/iron_leggings.png',   '#5D6D7E'],
  ['Items/iron_boots.png',      '#5D6D7E'],
  ['Items/iron_gloves.png',     '#5D6D7E'],
  // armor — shadow
  ['Items/shadow_helmet.png',     '#512E5F'],
  ['Items/shadow_chestplate.png', '#512E5F'],
  ['Items/shadow_leggings.png',   '#512E5F'],
  ['Items/shadow_boots.png',      '#512E5F'],
  ['Items/shadow_gloves.png',     '#512E5F'],
]
for (const [p, c] of ITEMS) write(p, icon16(c))

console.log('\n=== Tile sprites — new unique tiles (16×16) ===')
const TILES = [
  // Ground — previously shared
  ['Ground/GrassDark.png',    '#2E7D32'],
  ['Ground/Mushroom.png',     '#BF360C'],
  ['Ground/Reeds.png',        '#558B2F'],
  ['Ground/Cobblestone.png',  '#757575'],
  ['Ground/GardenPlot.png',   '#5D4037'],
  ['Ground/Quicksand.png',    '#F9A825'],
  ['Ground/SandBank.png',     '#FDD835'],
  ['Ground/Void.png',         '#212121'],
  // Nature — previously shared
  ['Nature/Bush.png',         '#388E3C'],
  ['Nature/Log.png',          '#6D4C41'],
  ['Nature/DryRock.png',      '#8D6E63'],
]
for (const [p, c] of TILES) write(p, icon16(c, '#000000', '#ffffff'))

console.log('\n=== Enemy spritesheets (80×128) ===')
const ENEMIES = [
  ['Enemies/wolf.png',              '#78909C'],
  ['Enemies/bandit_weak.png',       '#BF360C'],
  ['Enemies/bandit_strong.png',     '#7B241C'],
  ['Enemies/giant_spider.png',      '#4A148C'],
  ['Enemies/goblin_scout_weak.png', '#2E7D32'],
  ['Enemies/treant.png',            '#1B5E20'],
  ['Enemies/river_troll.png',       '#1565C0'],
  ['Enemies/crocodile.png',         '#558B2F'],
  ['Enemies/water_spirit.png',      '#0288D1'],
  ['Enemies/scorpion.png',          '#E65100'],
  ['Enemies/sand_worm.png',         '#F9A825'],
  ['Enemies/mummy.png',             '#EF9A9A'],
  ['Enemies/desert_bandit.png',     '#D84315'],
  ['Enemies/thief.png',             '#6A1B9A'],
  ['Enemies/dark_mage_weak.png',    '#283593'],
  ['Enemies/dark_mage_strong.png',  '#1A237E'],
  ['Enemies/skeleton.png',          '#BDBDBD'],
  ['Enemies/slime_weak.png',        '#A5D6A7'],
  ['Enemies/slime_corrosive.png',   '#AED581'],
  ['Enemies/zombie.png',            '#4E342E'],
  ['Enemies/dark_knight_weak.png',  '#37474F'],
  ['Enemies/dark_knight_elite.png', '#212121'],
  ['Enemies/ghost.png',             '#B0BEC5'],
  ['Enemies/necromancer.png',       '#311B92'],
  ['Enemies/dungeon_boss_strong.png','#B71C1C'],
]
for (const [p, c] of ENEMIES) overwrite(p, sheet(c))

console.log('\n=== NPC spritesheets (80×128) ===')
const NPCS = [
  ['NPCs/guard_patrol.png',       '#1565C0'],
  ['NPCs/healer_standard.png',    '#AD1457'],
  ['NPCs/merchant_standard.png',  '#F57F17'],
  ['NPCs/villager_fisherman.png', '#00838F'],
  ['NPCs/villager_gossiper.png',  '#6A1B9A'],
  ['NPCs/villager_hunter.png',    '#33691E'],
  ['NPCs/villager_wanderer.png',  '#4E342E'],
]
for (const [p, c] of NPCS) overwrite(p, sheet(c))

console.log('\n=== Champion spritesheets (80×128) ===')
const CHAMPIONS = [
  ['Champions/Arthax.png',    '#1565C0'],
  ['Champions/Börg.png',      '#B71C1C'],
  ['Champions/Gangblanc.png', '#212121'],
  ['Champions/Grum.png',      '#4E342E'],
  ['Champions/Kanji.png',     '#880E4F'],
  ['Champions/Katan.png',     '#E65100'],
  ['Champions/Okomo.png',     '#1B5E20'],
  ['Champions/Zhinja.png',    '#4527A0'],
]
for (const [p, c] of CHAMPIONS) overwrite(p, sheet(c))

console.log('\nDone.\n')
