/**
 * gen-placeholders.cjs
 * Generates placeholder PNG files for every sprite the game expects but
 * that is either missing or not yet replaced with real art.
 *
 * Run once:  node scripts/gen-placeholders.cjs
 *
 * Sprite directory layout (public/assets/sprites/):
 *   World/Ground/    — terrain tiles (16×16)
 *   World/Nature/    — natural world objects (16×16)
 *   World/Buildings/ — structures visible in the overworld (16×16)
 *   Player/          — champion spritesheets (80×128) + login previews
 *   Enemies/         — enemy spritesheets (80×128)
 *   NPCs/            — NPC spritesheets (80×128)
 *   Items/           — consumables, materials, keys (16×16)
 *   Weapons/         — weapon icons (16×16)
 *   Armors/          — armor icons (16×16)
 *   Tools/           — tool icons (16×16)
 *   Dungeon/         — dungeon INTERIOR: floor, walls, stairs, props (16×16)
 *   House/           — house INTERIOR: floor, door, furniture (16×16)
 *   Cellars/         — cellar INTERIOR: floor, walls, props (16×16)
 *
 * Spritesheet format (80×128):
 *   5 columns × 8 rows of 16×16 frames
 *   Rows 0-3 = walk (down/up/right/left)
 *   Rows 4-7 = attack (down/up/right/left)
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

/** Create a W×H RGBA PNG. `fill(x, y)` returns [r, g, b, a] for each pixel. */
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
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y)
      const o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = r; raw[o+1] = g; raw[o+2] = b; raw[o+3] = a
    }
  }
  return Buffer.concat([sig, ihdr, chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
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
 * Grid lines mark frame boundaries; col-0 rows get a centre dot.
 */
function sheet(bgHex) {
  const [r, g, b] = hex(bgHex)
  const COLS = 5, ROWS = 8, F = 16
  return makePNG(COLS * F, ROWS * F, (x, y) => {
    const col = Math.floor(x / F)
    const lx  = x % F, ly = y % F
    const grid = lx === 0 || ly === 0
    if (grid) return [255, 255, 255, 80]
    const dark = Math.floor(y / F) >= 4 ? 0.6 : 1.0
    const dot  = col === 0 && lx >= 6 && lx <= 9 && ly >= 6 && ly <= 9
    if (dot) return [255, 255, 255, 200]
    return [Math.round(r * dark), Math.round(g * dark), Math.round(b * dark), 255]
  })
}

// ── Write helper ─────────────────────────────────────────────────────────────

/** Write `relPath` (relative to SPRITES/) only if the file doesn't already exist. */
function write(relPath, buf) {
  const full = path.join(SPRITES, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  if (fs.existsSync(full)) {
    console.log(`  skip  ${relPath}`)
    return
  }
  fs.writeFileSync(full, buf)
  console.log(`  wrote ${relPath}`)
}

// ── World/Buildings — overworld structures (16×16) ───────────────────────────

console.log('\n=== World/Buildings — overworld structures (16×16) ===')
const WORLD_BUILDINGS = [
  // Village buildings (exterior, seen in the world map)
  ['World/Buildings/Huts.png',             '#8D6E63'],
  ['World/Buildings/Houses.png',           '#A1887F'],
  ['World/Buildings/Barracks.png',         '#546E7A'],
  ['World/Buildings/Chapels.png',          '#F5F5F5'],
  ['World/Buildings/Taverns.png',          '#BF360C'],
  ['World/Buildings/Workshops.png',        '#4E342E'],
  ['World/Buildings/Market.png',           '#F57F17'],
  ['World/Buildings/Well.png',             '#78909C'],
  ['World/Buildings/QuestBoard.png',       '#FFB300'],
  ['World/Buildings/StreetSign.png',       '#8D6E63'],
  ['World/Buildings/Tombstone.png',        '#757575'],
  // Dungeon entrance (visible in the overworld)
  ['World/Buildings/DungeonEntrance.png',  '#37474F'],
]
for (const [p, c] of WORLD_BUILDINGS) write(p, icon16(c))

// ── World/Ground — terrain tiles (16×16) ─────────────────────────────────────

console.log('\n=== World/Ground — terrain tiles (16×16) ===')
const GROUND_TILES = [
  ['World/Ground/Grass.png',             '#4CAF50'],
  ['World/Ground/GrassDark.png',         '#2E7D32'],
  ['World/Ground/GrassTall.png',         '#388E3C'],
  ['World/Ground/GrassFlowerYellow.png', '#CDDC39'],
  ['World/Ground/GrassFlowerRed.png',    '#E53935'],
  ['World/Ground/GrassDead.png',         '#8D6E63'],
  ['World/Ground/PathDirt.png',          '#A1887F'],
  ['World/Ground/WaterShallow.png',      '#81D4FA'],
  ['World/Ground/WaterDeep.png',         '#0277BD'],
  ['World/Ground/WaterOasis.png',        '#0288D1'],
  ['World/Ground/Sand.png',              '#FFD54F'],
  ['World/Ground/SandDune.png',          '#FFB300'],
  ['World/Ground/SandBank.png',          '#FDD835'],
  ['World/Ground/Mud.png',               '#6D4C41'],
  ['World/Ground/Cobblestone.png',       '#757575'],
  ['World/Ground/GardenPlot.png',        '#5D4037'],
  ['World/Ground/Mushroom.png',          '#BF360C'],
  ['World/Ground/Reeds.png',             '#558B2F'],
  ['World/Ground/Quicksand.png',         '#F9A825'],
  ['World/Ground/Void.png',              '#212121'],
]
for (const [p, c] of GROUND_TILES) write(p, icon16(c))

// ── World/Nature — natural objects (16×16) ────────────────────────────────────

console.log('\n=== World/Nature — natural objects (16×16) ===')
const NATURE_TILES = [
  ['World/Nature/Trees.png',       '#2E7D32'],
  ['World/Nature/PineTrees.png',   '#1B5E20'],
  ['World/Nature/CoconutTrees.png','#33691E'],
  ['World/Nature/Bush.png',        '#388E3C'],
  ['World/Nature/Log.png',         '#6D4C41'],
  ['World/Nature/Stump.png',       '#795548'],
  ['World/Nature/RockSmall.png',   '#9E9E9E'],
  ['World/Nature/RocksBig.png',    '#757575'],
  ['World/Nature/RockMoss.png',    '#558B2F'],
  ['World/Nature/DryRock.png',     '#8D6E63'],
  ['World/Nature/Cactus.png',      '#689F38'],
  ['World/Nature/Tumbleweed.png',  '#A5D6A7'],
  ['World/Nature/Wheatfield.png',  '#F9A825'],
  ['World/Nature/Cliff.png',       '#616161'],
]
for (const [p, c] of NATURE_TILES) write(p, icon16(c))

// ── Player — champion spritesheets (80×128) ───────────────────────────────────

console.log('\n=== Player — champion spritesheets (80×128) ===')
const PLAYER_SHEETS = [
  ['Player/Arthax.png',    '#1565C0'],
  ['Player/Börg.png',      '#B71C1C'],
  ['Player/Gangblanc.png', '#212121'],
  ['Player/Grum.png',      '#4E342E'],
  ['Player/Kanji.png',     '#880E4F'],
  ['Player/Katan.png',     '#E65100'],
  ['Player/Okomo.png',     '#1B5E20'],
  ['Player/Zhinja.png',    '#4527A0'],
  // Login preview avatars (same sheets, same files)
  ['Player/player_arthax.png',    '#1565C0'],
  ['Player/player_borg.png',      '#B71C1C'],
  ['Player/player_gangblanc.png', '#212121'],
  ['Player/player_grum.png',      '#4E342E'],
  ['Player/player_kanji.png',     '#880E4F'],
  ['Player/player_katan.png',     '#E65100'],
  ['Player/player_okomo.png',     '#1B5E20'],
  ['Player/player_zhinja.png',    '#4527A0'],
]
for (const [p, c] of PLAYER_SHEETS) write(p, sheet(c))

// ── Enemies — enemy spritesheets (80×128) ────────────────────────────────────

console.log('\n=== Enemies — spritesheets (80×128) ===')
const ENEMIES = [
  ['Enemies/wolf.png',              '#78909C'],
  ['Enemies/bandit_weak.png',       '#BF360C'],
  ['Enemies/bandit_strong.png',     '#7B241C'],
  ['Enemies/giant_spider.png',      '#4A148C'],
  ['Enemies/goblin_scout_weak.png', '#2E7D32'],
  ['Enemies/goblin_scout_strong.png','#1B5E20'],
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
for (const [p, c] of ENEMIES) write(p, sheet(c))

// ── NPCs — NPC spritesheets (80×128) ─────────────────────────────────────────

console.log('\n=== NPCs — spritesheets (80×128) ===')
const NPCS = [
  ['NPCs/guard_patrol.png',       '#1565C0'],
  ['NPCs/healer_standard.png',    '#AD1457'],
  ['NPCs/merchant_standard.png',  '#F57F17'],
  ['NPCs/villager_fisherman.png', '#00838F'],
  ['NPCs/villager_gossiper.png',  '#6A1B9A'],
  ['NPCs/villager_hunter.png',    '#33691E'],
  ['NPCs/villager_wanderer.png',  '#4E342E'],
]
for (const [p, c] of NPCS) write(p, sheet(c))

// ── Items — consumables + materials + keys (16×16) ────────────────────────────

console.log('\n=== Items — consumables, materials, keys (16×16) ===')
const ITEMS = [
  ['Items/wood.png',           '#8B5E3C'],
  ['Items/stone.png',          '#8E8E8E'],
  ['Items/iron_ore.png',       '#A0522D'],
  ['Items/iron_bar.png',       '#708090'],
  ['Items/leather.png',        '#8B4513'],
  ['Items/gold_coin.png',      '#FFD700'],
  ['Items/mushroom.png',       '#C0392B'],
  ['Items/health_potion.png',  '#E74C3C'],
  ['Items/mana_potion.png',    '#3498DB'],
  ['Items/antidote.png',       '#2ECC71'],
  ['Items/cooked_mushroom.png','#E67E22'],
  ['Items/dungeon_key.png',    '#F1C40F'],
]
for (const [p, c] of ITEMS) write(p, icon16(c))

// ── Weapons — weapon icons (16×16) ────────────────────────────────────────────

console.log('\n=== Weapons — icons (16×16) ===')
const WEAPONS = [
  ['Weapons/wooden_sword.png', '#D4AC6E'],
  ['Weapons/iron_sword.png',   '#5D6D7E'],
  ['Weapons/iron_axe.png',     '#5D6D7E'],
  ['Weapons/shadow_blade.png', '#6C3483'],
  ['Weapons/wooden_bow.png',   '#BA8C63'],
  ['Weapons/iron_bow.png',     '#5D6D7E'],
  ['Weapons/oak_staff.png',    '#7D6608'],
  ['Weapons/iron_staff.png',   '#1A5276'],
]
for (const [p, c] of WEAPONS) write(p, icon16(c))

// ── Armors — armor icons (16×16) ──────────────────────────────────────────────

console.log('\n=== Armors — icons (16×16) ===')
const ARMORS = [
  ['Armors/leather_helmet.png',     '#935116'],
  ['Armors/leather_chestplate.png', '#935116'],
  ['Armors/leather_leggings.png',   '#935116'],
  ['Armors/leather_boots.png',      '#935116'],
  ['Armors/leather_gloves.png',     '#935116'],
  ['Armors/iron_helmet.png',        '#5D6D7E'],
  ['Armors/iron_chestplate.png',    '#5D6D7E'],
  ['Armors/iron_leggings.png',      '#5D6D7E'],
  ['Armors/iron_boots.png',         '#5D6D7E'],
  ['Armors/iron_gloves.png',        '#5D6D7E'],
  ['Armors/shadow_helmet.png',      '#512E5F'],
  ['Armors/shadow_chestplate.png',  '#512E5F'],
  ['Armors/shadow_leggings.png',    '#512E5F'],
  ['Armors/shadow_boots.png',       '#512E5F'],
  ['Armors/shadow_gloves.png',      '#512E5F'],
]
for (const [p, c] of ARMORS) write(p, icon16(c))

// ── Tools — tool icons (16×16) ────────────────────────────────────────────────

console.log('\n=== Tools — icons (16×16) ===')
const TOOLS = [
  ['Tools/axe.png',     '#7F8C8D'],
  ['Tools/pickaxe.png', '#95A5A6'],
  ['Tools/scythe.png',  '#AAB7B8'],
]
for (const [p, c] of TOOLS) write(p, icon16(c))

// ── Dungeon — buildings, props, floor, stairs (16×16) ────────────────────────

console.log('\n=== Dungeon — buildings, props, floor (16×16) ===')
const DUNGEON = [
  ['Dungeon/DungeonEntrance.png', '#37474F'],
  ['Dungeon/DungeonFloor.png',    '#455A64'],
  ['Dungeon/DungeonWall.png',     '#263238'],
  ['Dungeon/DungeonPillar.png',   '#37474F'],
  ['Dungeon/StairDown.png',       '#546E7A'],
  ['Dungeon/StairUp.png',         '#607D8B'],
  ['Dungeon/DungeonTrap.png',     '#B71C1C'],
  ['Dungeon/DungeonAltar.png',    '#4527A0'],
  ['Dungeon/Chest.png',           '#8D6E63'],
  ['Dungeon/Tombstone.png',       '#616161'],
]
for (const [p, c] of DUNGEON) write(p, icon16(c))

// ── House — INTERIOR only: floor, door, furniture (16×16) ────────────────────

console.log('\n=== House — interior: floor, door, furniture (16×16) ===')
const HOUSE = [
  ['House/HouseFloor.png', '#BCAAA4'],   // interior floor tile
  ['House/Door.png',       '#6D4C41'],   // house exit door
  ['House/WorkBench.png',  '#795548'],   // crafting station
  ['House/Table.png',      '#A1887F'],   // furniture
  ['House/Bed.png',        '#E53935'],   // furniture
  ['House/Sofa.png',       '#7986CB'],   // furniture
  ['House/Chest.png',      '#A1887F'],   // loot chest
  ['House/Portal.png',     '#7C4DFF'],   // magic portal exit
  // QuestBoard is copied from World/Buildings/ — same visual, editable separately
  ['House/QuestBoard.png', '#FFB300'],
]
for (const [p, c] of HOUSE) write(p, icon16(c))

// ── Cellars — cellar environments (16×16) ─────────────────────────────────────

console.log('\n=== Cellars — floor, walls, props (16×16) ===')
const CELLARS = [
  ['Cellars/CellarFloor.png',     '#4A3F35'],
  ['Cellars/CellarWall.png',      '#2D2520'],
  ['Cellars/CellarChest.png',     '#6B4226'],
  ['Cellars/CellarTrap.png',      '#5C3B1A'],
  ['Cellars/CellarStairsUp.png',  '#7A6652'],
]
for (const [p, c] of CELLARS) write(p, icon16(c))

console.log('\nDone.\n')
