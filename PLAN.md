# RPG Game Implementation Plan

## Overview

A multiplayer browser-based RPG with a 1000×1000 bounded world that is generated lazily as players explore, Firebase persistence, distributed NPC/enemy script execution, and Python-scriptable entity behaviors. No dedicated server — all clients connect directly to Firebase.

---

## Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Browser (Web App) | No server needed; Firebase SDK works natively |
| Language | TypeScript | Type safety for complex entity schemas |
| Renderer | Phaser 3 | Tile-map rendering, input, camera, scene management |
| Database | Firebase Realtime Database | Single table, real-time sync, offline support |
| Auth | Firebase Realtime Database (custom) | Name + password stored in player template (hashed) |
| Python runtime | Pyodide (WASM) | Runs Python scripts client-side for entity behaviors |
| Map generation | `simplex-noise` library | Deterministic 1000×1000 world, generated lazily on exploration |
| Build tool | Vite | Fast HMR, TypeScript support |

---

## Phase 1 — Project Scaffold & Firebase Setup

### Step 1.1 — Initialize project
- `npm create vite@latest rpidigo -- --template vanilla-ts`
- Install dependencies: `phaser`, `firebase`, `pyodide`, `simplex-noise`
- Configure `tsconfig.json` and `vite.config.ts`

### Step 1.2 — Firebase project setup
- Create Firebase project in Firebase Console
- Enable **Realtime Database** (not Firestore — single-table requirement)
- Configure security rules: authenticate via custom token or allow read/write with player key validation
- Create `src/firebase.ts` initializing the Firebase app with config from `.env`

### Step 1.3 — Database schema design

The database is split into purpose-built top-level collections. Each has a single responsibility and its own security scope.

---

#### `/config` — World configuration (written once; read at startup)
```
config/
  seed:    number                     # deterministic world seed
  pois:    { villages: [...], dungeons: [...] }
  extensions/                         # runtime content additions — merged into registries at startup
    tiles/    { [id]: TileDefinition }
    enemies/  { [id]: EnemyDefinition }
    zones/    { [id]: ZoneDefinition }
    items/    { [id]: ItemDefinition }
    weapons/  { [id]: WeaponDefinition }
    armors/   { [id]: ArmorDefinition }
    recipes/  { [id]: RecipeDefinition }
```

---

#### `/map/{room}/{x}_{y}` — Tile data (written once at generation)
```
map/
  {room}/                             # "0" = overworld; "dungeon_{id}_floor_{n}" = dungeon room
    {x}_{y}/                          # e.g.  map/0/15_23
      type:     string                # tile id from TileRegistry
      variant:  string                # visual variant (optional)
      metadata: {                     # mutable state on the tile itself
        gold?:    number              # chest gold amount (set at generation)
        opened?:  boolean             # chest opened flag
        regenAt?: number              # timestamp when depleted tile regenerates
      }
```
*Tile data is never overwritten by generation once written. Player modifications (chopped tree → stump, placed house) persist permanently.*

---

#### `/players/{id}` — Canonical player state
```
players/
  {id}/
    id:            string
    name:          string
    passwordHash:  string             # SHA-256
    level:         number
    xp:            number
    hp:            number
    maxHp:         number
    mp:            number
    maxMp:         number
    stats:         { strength, agility, intelligence, endurance }
    power:         number             # computed: baseStrength×2 + weaponPower + glovesBonus
    totalDefense:  number             # computed: endurance×0.5 + sum(armor.defense)
    gold:          number
    inventory:     [{ itemId, quantity, metadata }]
    equippedWeapon: string | null
    equippedArmor: { helmet, chestplate, leggings, boots, gloves }
    room:          string             # current room key
    x:             number
    y:             number
    house:         { room, x, y }
    online:        boolean
    lastSeen:      number             # Unix ms — used for stale-presence cleanup
```
*Position is a field here — movement only writes `room`, `x`, `y` (and the presence entry). No full-document delete/rewrite.*

---

#### `/entities` — Full NPC and enemy state
```
entities/
  npcs/
    {id}/
      id:               string
      templateId:       string        # NpcDefinition id e.g. 'villager.gossiper'
      baseType:         string
      variant:          string
      hp:               number
      maxHp:            number
      mp:               number
      maxMp:            number
      power:            number
      room:             string
      x:                number
      y:                number
      homeX:            number        # wander anchor
      homeY:            number
      villageId:        string        # used by merchant for shop context
      zoneId:           string
      state:            string        # 'idle' | 'wander' | 'talk' | 'follow' | 'flee'
      executingPlayerId: string | null
      script:           string
      memory:           {}

  enemies/
    {id}/
      id:               string
      templateId:       string        # EnemyDefinition id e.g. 'wolf.aggressive'
      baseType:         string
      variant:          string
      hp:               number
      maxHp:            number
      mp:               number
      maxMp:            number
      power:            number
      room:             string
      x:                number
      y:                number
      spawnRoom:        string        # original spawn location (for respawn)
      spawnX:           number
      spawnY:           number
      state:            string        # 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'dead'
      executingPlayerId: string | null
      script:           string
      memory:           {}
      carriedGold:      number        # gold stolen from players; returned as loot on death
```

---

#### `/presence/{room}` — Lightweight render index (Phaser subscribes here)
```
presence/
  {room}/
    players/
      {id}/   { x, y, name, level, spriteFrame, state }
    npcs/
      {id}/   { x, y, templateId, state }
    enemies/
      {id}/   { x, y, templateId, state, hp }   # hp for health bar rendering
    loot/
      {lootId}/  { x, y, items: [...], gold: N }
```
*Only what the renderer needs. Updated on every move — just coordinates and state, not full entity data.*

---

#### `/chat/{room}` — Proximity chat
```
chat/
  {room}/       # "0" = overworld; "dungeon_{id}_floor_{n}"; "house_{playerId}"
    {timestamp}/
      playerId:  string
      name:      string
      x:         number
      y:         number
      text:      string
      timestamp: number
```

---

#### `/shops/{villageId}` — Per-village shop state
```
shops/
  {villageId}/
    lastRestock:  number              # Unix ms of last daily restock
    limitedStock: { [itemId]: number } # remaining quantity for capped items only
```

---

**Documents:**

`PlayerInstance` (stored at `/players/{id}`):
```json
{
  "id": "string",
  "name": "string",
  "passwordHash": "string",
  "level": 1,
  "xp": 0,
  "hp": 100, "maxHp": 100,
  "mp": 50,  "maxMp": 50,
  "stats": { "strength": 5, "agility": 5, "intelligence": 5, "endurance": 5 },
  "power": 10,
  "totalDefense": 2,
  "gold": 0,
  "inventory": [],
  "equippedWeapon": null,
  "equippedArmor": { "helmet": null, "chestplate": null, "leggings": null, "boots": null, "gloves": null },
  "room": "0",
  "x": 0, "y": 0,
  "house": { "room": "0", "x": 0, "y": 0 },
  "online": false,
  "lastSeen": 0
}
```

`NpcInstance` (stored at `/entities/npcs/{id}`):
```json
{
  "id": "string",
  "templateId": "villager.wanderer",
  "baseType": "villager",
  "variant": "wanderer",
  "hp": 80, "maxHp": 80,
  "mp": 0,  "maxMp": 0,
  "power": 0,
  "room": "0", "x": 0, "y": 0,
  "homeX": 0, "homeY": 0,
  "villageId": "v_3_4",
  "zoneId": "plains",
  "state": "idle",
  "executingPlayerId": null,
  "script": "# python behavior script",
  "memory": {}
}
```

`EnemyInstance` (stored at `/entities/enemies/{id}`):
```json
{
  "id": "string",
  "templateId": "wolf.aggressive",
  "baseType": "wolf",
  "variant": "aggressive",
  "hp": 45, "maxHp": 45,
  "mp": 0,  "maxMp": 0,
  "power": 12,
  "room": "0", "x": 0, "y": 0,
  "spawnRoom": "0", "spawnX": 0, "spawnY": 0,
  "state": "idle",
  "executingPlayerId": null,
  "script": "# python behavior script",
  "memory": {},
  "carriedGold": 0
}
```

### Step 1.4 — Data-driven content architecture (`src/data/` + `src/registry/`)

All game content (tiles, enemies, zones, items, weapons, recipes) is defined as plain data objects — never hardcoded into engine logic. The engine only depends on the interfaces below, never on specific IDs.

**TypeScript interfaces** (`src/registry/types.ts`):

```typescript
interface TileDefinition {
  id: string
  passable: boolean
  speedMod: number          // 1.0 = normal, 0.5 = slow, 0 = blocked
  destructible: boolean
  gatherAction?: 'chop' | 'mine' | 'cut' | 'pick'
  dropTable?: DropEntry[]   // [{ itemId, min, max, chance }]
  becomesOnGather?: string  // tile id after gathering
  regenSeconds?: number
  spriteFrame: string       // frame name in tileset sprite sheet
  ambientSound?: string
}

interface EnemyDefinition {
  id: string          // format: '{baseType}.{profile}'  e.g. 'wolf.aggressive', 'slime.typeA', 'goblin.special1'
  baseType: string    // species name  e.g. 'wolf' — groups profiles; used for display name and sprite fallback
  variant: string     // arbitrary profile label — any string is valid: 'weak', 'aggressive', 'typeA', 'special1', 'enraged', 'boss', etc.
  displayName: string // shown to the player  e.g. 'Wolf'
  baseHp: number
  basePower: number
  baseMp: number
  aggroRange: number
  speed: 'slow' | 'normal' | 'fast'
  levelRange: [number, number]
  lootTable: DropEntry[]
  behaviorScript: string  // Python script body — unique per variant
  spriteFrame: string     // defaults to baseType frame if variant has no dedicated art
  special?: string[]      // e.g. ['ignores_walls', 'summons_skeletons', 'steals_gold']
  stealGold?: [number, number]  // [min, max] gold stolen per hit — only set on thief/bandit types
}

interface ZoneDefinition {
  id: string
  elevationRange: [number, number]   // [min, max] noise values 0–1
  moistureRange:  [number, number]
  tileProbabilities: Record<string, number>  // tileId → weight
  spawnTable: { id: string; weight: number; levelRange?: [number, number] }[]
  // id is any valid EnemyDefinition id (e.g. 'wolf.aggressive', 'slime.typeA', 'goblin.special1')
  // weight is relative — wolf.aggressive:70 wolf.berserker:30 means 70% chance of aggressive wolf when a wolf spawns
  ambientSound: string
  musicTrack: string
}

interface ItemDefinition {
  id: string
  name: string
  stackable: boolean
  maxStack: number
  spriteFrame: string
  category: 'material' | 'weapon' | 'consumable' | 'tool' | 'key'
}

interface WeaponDefinition extends ItemDefinition {
  power: number
  weaponType: 'melee' | 'ranged' | 'magic'
  levelRequired: number
  specialEffect?: string    // 'poison', 'area', 'lifesteal', etc.
  mpCostPerSwing?: number
  animFrame: string
}

interface ArmorDefinition extends ItemDefinition {
  armorSlot: 'helmet' | 'chestplate' | 'leggings' | 'boots' | 'gloves'
  defense: number
  levelRequired: number
  specialEffect?: string    // 'lifesteal', 'speed_boost', 'power_bonus'
  agilityMod?: number       // optional movement penalty for heavy pieces
}

interface ShopStockEntry {
  itemId: string            // weapon, armor, or material id
  baseBuyPrice: number      // gold cost to buy from shop
  sellMultiplier: number    // fraction of buy price the shop pays (default 0.5)
  maxQuantity: number       // -1 = unlimited; positive = restocks once per real-time day
}

// Zone price multipliers for ShopManager — applied on top of baseBuyPrice
// Built-in multiplier table: Record<zoneId, Record<itemCategory, number>>
// e.g. forest zone: wood/fiber/leather-armor × 0.7, iron_ore × 1.4
// Each village also gets ±15% jitter seeded from its POI seed

interface RecipeDefinition {
  id: string
  produces: string          // itemId (weapon or tool)
  quantity: number
  requires: { itemId: string; qty: number }[]
  station: 'workbench' | 'blacksmith_forge' | 'dungeon_altar'
  levelRequired: number
}
```

**Data files** — pure TypeScript arrays of definitions, imported at startup:

```
src/data/
  tiles.ts      → TileDefinition[]
  enemies.ts    → EnemyDefinition[]
  zones.ts      → ZoneDefinition[]
  items.ts      → ItemDefinition[]   (materials + consumables)
  weapons.ts    → WeaponDefinition[]
  armors.ts     → ArmorDefinition[]
  recipes.ts    → RecipeDefinition[]
  shop.ts       → ShopStockEntry[]   (base stock; ShopManager builds per-village instances with zone multipliers + seed jitter)
```

**Registry classes** (`src/registry/`):
- One registry per content type: `TileRegistry`, `EnemyRegistry`, `ZoneRegistry`, `ItemRegistry`, `WeaponRegistry`, `ArmorRegistry`, `RecipeRegistry`
- Each exposes: `register(def)`, `get(id): Def`, `getAll(): Def[]`, `has(id): boolean`
- Engine systems import registries only — never raw data files

**Bootstrap sequence** (`src/registry/bootstrap.ts`):
```typescript
// 1. Load all built-in definitions
TileRegistry.registerAll(tiles)
EnemyRegistry.registerAll(enemies)
// ...

// 2. Fetch Firebase extensions and merge (overrides or additions)
const ext = await get(ref(db, 'config/extensions'))
if (ext.exists()) mergeExtensions(ext.val())

// 3. World systems are now ready
```

This means: adding new content = add a definition object to a data file (or push one to Firebase). No engine code changes required.

---

## Phase 2 — World Map Generation

### Step 2.1 — Bounded deterministic map generator (`src/world/WorldGen.ts`)
- World is a fixed **1000×1000** grid (coordinates 0–999 on each axis)
- Use `simplex-noise` with a fixed global seed stored in Firebase (`config/seed`) — same seed produces the same tile for any (x, y) on every client
- `generateCell(x, y): TileData` → returns tile type and zone purely from noise; no Firebase read required
- Bounds guard: any call outside [0, 999] returns a `void` (impassable barrier) tile

---

#### Zone system (`src/world/ZoneMap.ts`)

Three stacked noise layers determine every cell's zone and tile:

| Noise layer | Scale | Purpose |
|---|---|---|
| `elevation` | 300 | Broad terrain shape (high = hills/desert, low = water/plains) |
| `moisture` | 200 | Wet vs dry (high = forest/river, low = desert) |
| `detail` | 20 | Fine variation within a zone (tile variant selection) |

**Zone lookup table** (evaluated in priority order):

| Zone | Condition | Notes |
|---|---|---|
| `river` | elevation < 0.25 AND moisture > 0.6 | Linear water features (see river pass below) |
| `desert` | elevation > 0.55 AND moisture < 0.35 | Arid zones |
| `forest` | moisture > 0.65 AND elevation 0.3–0.7 | Dense woodland |
| `plains` | default (everything else) | Open grassland |
| `village` | POI grid (see below) | Structured, overrides noise |
| `dungeon` | POI grid (see below) | Structured, overrides noise |

**River pass** — applied after zone assignment:
- Trace river paths using elevation gradient flow (downhill from peaks to edges)
- River cells form connected horizontal/vertical chains, not isolated patches
- River banks (1-tile border around river) become `sand_bank` or `reeds`

**Point-of-interest (POI) placement** — deterministic grid + jitter:
- Divide the 1000×1000 world into a **10×10 grid** of 100×100-tile sectors
- Each sector contains exactly **one village** and **one dungeon entrance**, placed at `sector_origin + noise_jitter(±20 tiles)`
- POI positions are computed at startup from the seed, stored in `config/pois`

---

#### Tile catalogue by zone

**Plains**

| Tile ID | Passable | Description |
|---|---|---|
| `grass` | ✓ | Base ground |
| `grass_tall` | ✓ | Dense grass (slower movement) |
| `flower_yellow` | ✓ | Decoration |
| `flower_red` | ✓ | Decoration |
| `dirt_path` | ✓ | Worn trail |
| `rock_small` | ✗ | Small boulder |
| `rock_large` | ✗ | Large boulder (mineable) |

**Forest**

| Tile ID | Passable | Description |
|---|---|---|
| `grass_dark` | ✓ | Forest floor |
| `tree_oak` | ✗ | Oak tree (choppable → `wood`) |
| `tree_pine` | ✗ | Pine tree (choppable → `wood`) |
| `tree_dead` | ✗ | Dead tree (choppable → `wood`, `fiber`) |
| `bush` | ✓ | Low shrub (yields `fiber`) |
| `mushroom` | ✓ | Collectible (crafting ingredient) |
| `log` | ✓ | Fallen log (decoration / minor cover) |
| `moss_rock` | ✗ | Mossy boulder (mineable → `stone`) |

**River / Water**

| Tile ID | Passable | Description |
|---|---|---|
| `water_shallow` | ✗ | Wading depth — blocks movement |
| `water_deep` | ✗ | Deep water |
| `sand_bank` | ✓ | River bank |
| `reeds` | ✓ | Riverside reeds (yields `fiber`) |
| `bridge` | ✓ | Auto-placed at road crossings over rivers |
| `mud` | ✓ | Slow-movement tile near banks |

**Desert**

| Tile ID | Passable | Description |
|---|---|---|
| `sand` | ✓ | Base desert ground |
| `sand_dune` | ✓ | Dune crest (decoration) |
| `dry_rock` | ✗ | Desert boulder (mineable → `stone`, `iron_ore`) |
| `cactus` | ✗ | Blocks movement; yields `fiber` if cut |
| `dry_grass` | ✓ | Sparse vegetation |
| `oasis_water` | ✗ | Small water patch in desert |
| `quicksand` | ✓ | Trap tile — slows movement, rare damage tick |

**Village** (structured, procedurally arranged per POI)

| Tile ID | Passable | Description |
|---|---|---|
| `cobblestone` | ✓ | Village paths and squares |
| `house_floor` | ✓ | Interior floor |
| `house_wall` | ✗ | Building wall |
| `house_door` | ✓ | Entry point to building interior |
| `house_roof` | — | Visual roof layer (rendered above sprites) |
| `well` | ✗ | Central village feature |
| `fence` | ✗ | Garden / yard border |
| `market_stall` | ✓ | Merchant interaction point |
| `blacksmith_forge` | ✓ | Craft station for metal weapons |
| `tavern_sign` | ✓ | Tavern entrance marker |
| `lantern` | ✓ | Decoration / light source |
| `garden_plot` | ✓ | Farmland decoration |

**Dungeon** (structured, BSP-generated rooms per POI)

| Tile ID | Passable | Description |
|---|---|---|
| `dungeon_entrance` | ✓ | World-map tile — enter to go underground |
| `dungeon_floor` | ✓ | Interior floor |
| `dungeon_wall` | ✗ | Interior wall |
| `dungeon_door` | ✓ | Room connector |
| `dungeon_stairs_down` | ✓ | Descend to next floor |
| `dungeon_stairs_up` | ✓ | Ascend to previous floor / exit |
| `dungeon_torch` | ✓ | Light source (decoration) |
| `dungeon_pillar` | ✗ | Structural pillar |
| `dungeon_trap` | ✓ | Pressure plate (hidden; triggers damage) |
| `dungeon_chest` | ✓ | Loot container |
| `dungeon_altar` | ✓ | Boss room feature |

**Special / Shared**

| Tile ID | Passable | Description |
|---|---|---|
| `house` | ✓ | Player house entrance on world map |
| `workbench` | ✓ | Crafting station (inside house interior) |
| `chest` | ✓ | World loot container |
| `stump` | ✓ | Chopped tree remnant (regenerates after timer) |
| `void` | ✗ | Out-of-bounds barrier |

---

#### Village layout generation (`src/world/VillageGen.ts`)
1. Place a **central well** at the POI origin
2. Radiate **cobblestone paths** in 4 cardinal directions (length 6–10 tiles)
3. Place **3–8 buildings** (5×4 to 8×6 tiles) along the paths — each is a rectangle of `house_wall` with a `house_door` facing the path and `house_floor` inside
4. Place one `blacksmith_forge` and one `market_stall` adjacent to the central square
5. Scatter `fence`, `lantern`, and `garden_plot` tiles as decoration
6. Spawn 2–4 villager NPCs, 1 merchant NPC, and 1–2 guard NPCs at fixed offsets from the well
   - Merchant NPC instance is given `villageId` and `zoneId` fields so its Python script can call `actions.openShop(villageId)` and `ShopManager` can resolve the correct price list
   - Initialize `/shops/{villageId}/lastRestock` to generation timestamp and `limitedStock` to default quantities

#### Dungeon layout generation (`src/world/DungeonGen.ts`)
1. Use **BSP (Binary Space Partitioning)** to split the dungeon room (`room = "dungeon_{id}_floor_{n}"`) into 6–12 rectangular rooms
2. Connect rooms with 1-tile-wide corridors (`dungeon_floor`); walls everywhere else
3. Place `dungeon_door` at corridor/room junctions
4. Scatter `dungeon_torch`, `dungeon_pillar`, and `dungeon_trap` tiles
5. Place `dungeon_chest` in dead-end rooms; seed each with `{ gold: randInt(20,80) * floorMultiplier, items: [...] }` — floor multiplier is `1 + (floorIndex * 0.5)`
6. Place `dungeon_stairs_down` on floor N and `dungeon_stairs_up` back to surface on floor 1
7. Final floor contains a `dungeon_altar` (boss room); boss room chest seeded with gold 200–400

### Step 2.2 — Lazy exploration system (`src/world/ExplorationManager.ts`)
World cells exist in one of two states:

| State | Meaning |
|---|---|
| **Unvisited** | No Firebase entry. Tile is computed locally from noise but not persisted. |
| **Visited** | Firebase entry exists. Persisted state is authoritative (may differ from noise if players modified it — chopped tree, placed house, etc.). |

**Generation radius — on spawn and on every player move:**
1. Compute the set of all cells within **radius 20** of the player's current position (a filled circle, ~1257 cells max)
2. For each cell in the radius, check `/map/{room}/{x}_{y}` via a single batched `get()` call
3. For cells that **do not exist** in Firebase: call `generateCell(x, y)`, write the result to Firebase in a single `update()` batch
4. For cells that **already exist**: skip — never overwrite persisted state
5. Subscribe to Firebase `onValue` only for cells within the visible viewport (~25×19 tiles); unsubscribe as they scroll off screen
6. Cache all radius-20 cells in memory (`Map<string, TileData>`) so re-reads are instant while the player is nearby

**On player movement:**
- Recalculate the radius-20 circle at the new position
- Diff against the previously generated set → only process the new crescent of cells that entered the radius
- This keeps each move's Firebase write cost proportional to the movement step (~20–60 new cells per tile moved), not the full radius

**World boundary enforcement:**
- `ExplorationManager` clamps the radius circle to [0, 999] — cells outside the world are never written to Firebase

### Step 2.3 — Zone-aware enemy spawning (`src/world/SpawnManager.ts`)
When `generateCell(x, y)` writes a new cell to Firebase, it also decides whether to spawn an enemy based on the cell's zone and a seeded spawn-chance roll.

**Spawn algorithm:**
1. Look up the zone's `spawnTable` from `ZoneRegistry`
2. Roll spawn chance (seeded by `worldSeed + x * 31 + y * 97` — deterministic, never re-rolls)
3. If spawning, pick a variant by weighted random from `spawnTable` entries
4. Write enemy instance to `/entities/enemies/{enemyId}` and a presence snapshot to `/presence/{room}/enemies/{enemyId}`

**Zone spawn tables** (variant IDs + relative weights):

| Zone | Spawn chance/cell | Spawn table |
|---|---|---|
| Plains | 2% | `wolf.weak` 60, `wolf.strong` 20, `bandit.weak` 15, `bandit.strong` 5 |
| Forest | 4% | `wolf.weak` 40, `wolf.strong` 20, `giant_spider.weak` 20, `goblin_scout.weak` 10, `treant.strong` 5, `giant_spider.venomous` 5 |
| River | 3% | `river_troll.weak` 40, `river_troll.strong` 20, `crocodile.weak` 25, `water_spirit.weak` 10, `water_spirit.enraged` 5 |
| Desert | 3% | `scorpion.weak` 35, `scorpion.giant` 15, `sand_worm.weak` 20, `mummy.weak` 20, `desert_bandit.strong` 10 |
| Village outskirts | 1% | `thief.weak` 60, `dark_mage.weak` 30, `dark_mage.strong` 10 |
| Dungeon floor 1 | 15%/room | `skeleton.weak` 40, `slime.weak` 30, `slime.corrosive` 10, `zombie.weak` 15, `zombie.armoured` 5 |
| Dungeon floor 2+ | 20%/room | `dark_knight.weak` 30, `dark_knight.elite` 20, `ghost.weak` 25, `ghost.enraged` 10, `necromancer.weak` 10, `necromancer.strong` 5 |
| Dungeon boss room | 100% | `dungeon_boss.strong` 100 |

- Boss room is always one `dungeon_boss.strong` instance — no weight roll needed
- Enemy instance JSON includes `templateId` (the full variant id), `baseType`, and `variant` for fast lookup

### Step 2.5 — Collision map
- Impassable tiles: all `tree_*`, `rock_*`, `moss_rock`, `cactus`, `water_*`, `oasis_water`, `house_wall`, `dungeon_wall`, `dungeon_pillar`, `fence`, `well`, `void`
- `isPassable(x, y)` checks local cache first, falls back to `generateCell` result
- Boundary check: `isPassable` returns `false` for any coordinate outside [0, 999]
- Slow-movement tiles (`grass_tall`, `mud`, `quicksand`, `sand_dune`) are passable but apply a movement speed penalty

---

## Phase 3 — Phaser 3 Renderer

### Step 3.1 — Tileset and assets
- Pixel-art tileset, 16×16 or 32×32 tiles, single sprite sheet with all tile IDs as named frames
- **Plains:** `grass`, `grass_tall`, `flower_yellow`, `flower_red`, `dirt_path`, `rock_small`, `rock_large`
- **Forest:** `grass_dark`, `tree_oak`, `tree_pine`, `tree_dead`, `bush`, `mushroom`, `log`, `moss_rock`, `stump`
- **River:** `water_shallow`, `water_deep`, `sand_bank`, `reeds`, `bridge`, `mud`
- **Desert:** `sand`, `sand_dune`, `dry_rock`, `cactus`, `dry_grass`, `oasis_water`, `quicksand`
- **Village:** `cobblestone`, `house_floor`, `house_wall`, `house_door`, `house_roof`, `well`, `fence`, `market_stall`, `blacksmith_forge`, `tavern_sign`, `lantern`, `garden_plot`
- **Dungeon:** `dungeon_entrance`, `dungeon_floor`, `dungeon_wall`, `dungeon_door`, `dungeon_stairs_down`, `dungeon_stairs_up`, `dungeon_torch`, `dungeon_pillar`, `dungeon_trap`, `dungeon_chest`, `dungeon_altar`
- **Special:** `house` (player house entrance), `workbench`, `chest`, `void`
- **Sprite sheets:** player (4-direction walk, 3-frame), NPC variants (villager, merchant, guard, blacksmith), enemy variants (wolf, spider, goblin, treant, troll, crocodile, scorpion, sand_worm, mummy, skeleton, slime, zombie, dark_knight, ghost, dungeon_boss)

### Step 3.2 — Scene structure
```
BootScene      → load assets
LoginScene     → name + password UI, create or load player
GameScene      → main gameplay (Phaser TilemapDynamic + entity sprites)
UIScene        → HUD overlay (HP/MP bars, inventory panel, chat/dialog)
CraftScene     → workbench crafting UI (additive overlay)
ShopScene      → village shop buy/sell panel (triggered by merchant.standard NPC interaction)
```

### Step 3.3 — Dynamic tilemap rendering (`src/renderer/TilemapRenderer.ts`)
- Use Phaser's `DynamicTilemapLayer` fed from `ChunkManager`
- Re-render tiles on Firebase cell updates
- Sprite pool for players, NPCs, enemies — reuse on move

### Step 3.4 — Camera
- Follow local player; smooth lerp
- Render depth-sorted sprites (y-sort for top-down feel)

---

## Phase 4 — Player System

### Step 4.1 — Authentication (`src/player/Auth.ts`)
- **First login:** hash password (SHA-256 via Web Crypto API), pick a random spawn point, create `PlayerInstance`, write to Firebase, then trigger initial world generation (see below)
- **Subsequent login:** query `/players` ordered by `name` field, compare hash, load saved state from `/players/{id}`
- Set `online: true` on connect; set `online: false` and `lastSeen: serverTimestamp()` via `onDisconnect`

**Random spawn placement (first login only):**
1. Pick random `x = randInt(50, 950)`, `y = randInt(50, 950)` — 50-tile margin keeps spawn away from world edges
2. Verify the chosen cell is passable; re-roll up to 10 times if not
3. Call `ExplorationManager.generateAround(x, y, radius=20)` to materialise the starting area **before** placing anything — so tile data is available for passability checks
4. Find the house position: scan up to 5 tiles away from spawn for the nearest `grass` cell; use that as `houseX, houseY`
5. Write the `house` tile to `/map/0/{houseX}_{houseY}` (overwrites the generated `grass`)
6. Write `PlayerInstance` to `/players/{id}` with `room: "0"`, `x`, `y`, `house`
7. Write presence entry to `/presence/0/players/{id}` with `{ x, y, name, level, spriteFrame, state: "idle" }`

### Step 4.2 — Player movement (`src/player/PlayerController.ts`)
- WASD / arrow key input; movement is client-predicted (apply locally, then sync to Firebase)
- On move: validate `isPassable(newX, newY)` against local tile cache
- **Same-room move** — single multi-path update (2 writes, no reads):
  ```typescript
  update(ref(db), {
    [`players/${id}/x`]: newX,
    [`players/${id}/y`]: newY,
    [`presence/${room}/players/${id}/x`]: newX,
    [`presence/${room}/players/${id}/y`]: newY,
  })
  ```
- **Room transition** (entering dungeon, house, etc.) — remove presence from old room, add to new room, update canonical position:
  ```typescript
  update(ref(db), {
    [`presence/${oldRoom}/players/${id}`]: null,           // remove
    [`presence/${newRoom}/players/${id}`]: presenceSnap,   // add
    [`players/${id}/room`]: newRoom,
    [`players/${id}/x`]:    newX,
    [`players/${id}/y`]:    newY,
  })
  ```
- On disconnect: `onDisconnect` removes `/presence/{room}/players/{id}` so stale entries don't accumulate

### Step 4.3 — Stats and power calculation (`src/player/Stats.ts`)
- `power = baseStrength * 2 + weaponPower + powerBonusFromGloves`
- `totalDefense = endurance * 0.5 + sum(equippedArmor[slot].defense for each filled slot)`
- Level-up thresholds: `xpForLevel(n) = 100 * n^1.5`
- Stat points awarded per level (distribute via UI)
- Special armor effects recalculated on equip/unequip: `speed_boost` (shadow boots — +20% tile traversal speed), `power_bonus` (shadow gloves — +5 flat power), `lifesteal` (shadow helmet/chestplate — heal 5% of damage dealt per piece)

### Step 4.4 — Inventory (`src/player/Inventory.ts`)
- Array of `{ itemId, quantity, metadata }` stored in player JSON
- `addItem`, `removeItem`, `equipWeapon`, `equipArmor(slot, armorId)`, `unequipArmor(slot)` operations
- `equipArmor` validates `armorId.armorSlot === slot` and `player.level >= armorDef.levelRequired`; swaps old piece back to inventory; writes `equippedArmor[slot]` and recalculates `totalDefense` in Firebase
- Weight limit optional (future extension)

### Step 4.5 — Houses
- House tile is **automatically placed near the spawn point** at player creation (see Step 4.1) — the player never needs to manually place it
- House position is stored in the `PlayerInstance` as `house: { x, y }` and never changes
- Entering the house tile transitions to the interior room (`room = "house_{playerId}"`)
- Interior is a fixed small room (e.g. 10×8 tiles) containing a `workbench` tile and a `chest` for personal storage
- On respawn after death the player reappears at the house position

---

## Phase 5 — NPC and Enemy State Machines

### Step 5.1 — State machine base class (`src/entities/StateMachine.ts`)
- Generic FSM: `states: Map<string, StateHandler>`, `currentState`, `transition(newState)`
- `StateHandler = { onEnter?, onTick(dt, entity, world), onExit? }`

### Step 5.2 — NPC states and profiles (`src/entities/NpcTemplate.ts`)

NPCs use the same `{baseType}.{profile}` convention as enemies. Profile names are free-form.

**States:** `idle`, `wander`, `talk`, `follow`, `flee`

**NpcDefinition** (added to `src/data/npcs.ts` and `src/registry/NpcRegistry.ts`):
```typescript
interface NpcDefinition {
  id: string          // '{baseType}.{profile}'  e.g. 'villager.wanderer', 'healer.standard'
  baseType: string
  variant: string     // free-form profile label
  displayName: string
  spriteFrame: string
  behaviorScript: string   // Python script — full behaviour per profile
  dialogLines?: string[]   // fallback static lines if script produces no speech
}
```

**Built-in NPC profiles and their Python scripts:**

---

`villager.wanderer` — roams the village, greets players:
```python
import random
player = world.nearestPlayer(entity, radius=3)
if player and not memory.get('greeted_' + player['id']):
    actions.speak(random.choice([
        'Hello, traveler!', 'Welcome to our village!', 'Safe roads to you.'
    ]))
    memory['greeted_' + player['id']] = True
    actions.setState('talk')
else:
    actions.setState('wander')
    home = (entity.get('homeX', entity['x']), entity.get('homeY', entity['y']))
    dx = random.choice([-1, 0, 0, 1])
    dy = random.choice([-1, 0, 0, 1])
    nx, ny = entity['x'] + dx, entity['y'] + dy
    if abs(nx - home[0]) <= 5 and abs(ny - home[1]) <= 5:
        actions.move(dx, dy)
```

---

`villager.hunter` — patrols the forest edge, talks about game:
```python
import random
player = world.nearestPlayer(entity, radius=2)
if player:
    actions.speak(random.choice([
        'The forest is dangerous after dark.',
        'I spotted wolves near the eastern treeline.',
        'Bring me hides and I might trade you something.'
    ]))
    actions.setState('talk')
else:
    actions.setState('patrol')
    actions.move(random.choice([-1, 0, 1]), random.choice([-1, 0, 1]))
```

---

`villager.fisherman` — stays near river tiles, shares river knowledge:
```python
import random
player = world.nearestPlayer(entity, radius=2)
if player:
    actions.speak(random.choice([
        'The river is full of fish today.',
        'I heard a water spirit upstream — stay away from the deep pools.',
        'River trolls come out at dusk. Cross at the bridge.'
    ]))
    actions.setState('talk')
else:
    actions.setState('idle')
```

---

`villager.gossiper` — shares world knowledge: dungeon locations, treasures, boss sightings, village directions:
```python
import random
player = world.nearestPlayer(entity, radius=3)
if player:
    pois   = world.getPOIs()
    lines  = []

    dungeons = pois.get('dungeons', [])
    if dungeons:
        d = random.choice(dungeons)
        lines.append(f"Rumour has it there's a dungeon entrance near ({d['x']}, {d['y']}).")

    villages = pois.get('villages', [])
    if villages:
        v = random.choice(villages)
        direction = 'north' if v['y'] < entity['y'] else 'south'
        direction += ' and east' if v['x'] > entity['x'] else ' and west'
        lines.append(f"Another village lies to the {direction}, about {abs(v['x']-entity['x'])+abs(v['y']-entity['y'])} tiles away.")

    bosses = pois.get('bosses', [])
    if bosses:
        b = random.choice(bosses)
        lines.append(f"Beware — a {b['type']} was spotted near ({b['x']}, {b['y']}). Powerful stuff.")

    lines += [
        'They say treasure chests are buried deep in the desert.',
        'The treants in the old forest guard something ancient.',
        'I once saw a dungeon boss drop a weapon that glowed blue.'
    ]

    actions.speak(random.choice(lines))
    actions.setState('talk')
else:
    actions.setState('idle')
```

---

`healer.standard` — restores player HP and MP on approach:
```python
player = world.nearestPlayer(entity, radius=2)
if player:
    actions.setState('talk')
    hp_missing = player['maxHp'] - player['hp']
    mp_missing = player['maxMp'] - player['mp']
    if hp_missing > 0 or mp_missing > 0:
        actions.speak('Let me restore your strength, traveler.')
        actions.heal(player['id'], hp=player['maxHp'], mp=player['maxMp'])
    else:
        actions.speak('You are in fine health. May your journey be safe.')
else:
    actions.setState('idle')
```

**`actions.heal(playerId, hp, mp)`** — new scripting API call (see Step 6.2); writes `hp` and `mp` values back to the player's Firebase entry. Clamps to `maxHp`/`maxMp`.

---

`merchant.standard` — greets players and opens the shop:
```python
import random
player = world.nearestPlayer(entity, radius=2)
if player:
    if not memory.get('greeted_' + player['id']):
        actions.speak(random.choice([
            'Welcome! I have wares if you have coin.',
            'Best prices in the region — come see!',
            'Looking to buy or sell? You\'ve come to the right place.'
        ]))
        memory['greeted_' + player['id']] = True
    if world.adjacent(entity, player):
        actions.openShop(entity.get('villageId'))   # triggers ShopScene on the player's client
    actions.setState('talk')
else:
    memory.clear()   # reset greetings when no players are near
    actions.setState('idle')
```

**`actions.openShop(villageId)`** — new scripting API call; triggers `ShopScene` on the interacting player's client. `ShopManager` uses `villageId` to look up zone and seed for price computation.

---

**Village NPC spawn placement** (wired into `VillageGen.ts`):

| Profile | Count per village | Placement |
|---|---|---|
| `villager.wanderer` | 2–4 | Random grass cells in village bounds |
| `villager.hunter` | 1 | Near village edge facing forest |
| `villager.fisherman` | 1 | Adjacent to nearest river or water tile |
| `villager.gossiper` | 1 | Near the central well |
| `healer.standard` | 1 | Inside or adjacent to a house building |
| `merchant.standard` | 1 | At `market_stall` tile |
| `guard.patrol` | 1–2 | At village entry paths |

### Step 5.3 — Enemy states, variants and templates (`src/entities/EnemyTemplate.ts`)
- States: `idle`, `patrol`, `chase`, `attack`, `flee`, `dead`
- Aggro range: if player within N tiles → `chase`
- Attack: if adjacent → deal `power` damage to player, apply cooldown
- `dead` state: drop loot, write loot to cell, remove enemy from Firebase after delay
- Enemy respawn: template stores `respawnTimer` (seconds); re-instantiate at original spawn cell

#### Variant system

Every enemy is identified by `{baseType}.{profile}`. The profile is a **free-form label** — any string is valid: `aggressive`, `typeA`, `special1`, `weak`, `strong`, `berserker`, `enraged`, `spectral`, `boss`, or anything else that describes the behaviour. Each profile is a **separate `EnemyDefinition`** with its own stats and its own Python behaviour script. Profiles of the same `baseType` share a display name and can share a sprite frame.

Rules for profile design:
- There is no required naming convention — use names that describe the behaviour (`aggressive`, `coward`, `healer`, `typeA`) or role (`special1`, `elite`, `miniboss`)
- A `baseType` can have one profile or many — add as many as the game needs
- Stats and the Python script are fully independent per profile; two profiles with identical stats but different scripts are perfectly valid
- The behaviour script is the primary differentiator: one profile may flee, another charge, another call reinforcements

**Example variant pairs:**

`wolf.weak`
- HP 25 · Power 6 · Speed fast
- Script: flees any player on sight; wanders otherwise

`wolf.strong`
- HP 45 · Power 12 · Speed fast
- Script: chases and attacks player; only flees at HP < 15%

`slime.weak`
- HP 20 · Power 4 · Speed slow
- Script: moves away from nearest player; does not attack

`slime.corrosive`
- HP 35 · Power 10 · Speed slow
- Script: actively chases and attacks; applies armour-reduction debuff on hit (via `special: ['corrodes_armor']`)

`necromancer.weak`
- HP 55 · Power 20 · Speed normal
- Script: keeps distance from player; casts ranged spell every 3 s

`necromancer.strong`
- HP 80 · Power 30 · Speed normal
- Script: keeps distance; re-spawns dead skeletons every 10 s via `world.nearbyDead(entity, 'skeleton', radius=5)` + `actions.revive(id)`

---

**Full variant catalogue** (`src/data/enemies.ts`):

| Variant ID | HP | Power | Speed | Behaviour summary | Loot |
|---|---|---|---|---|---|
| `wolf.weak` | 25 | 6 | fast | flees on sight | `hide` x1 |
| `wolf.strong` | 45 | 12 | fast | chases; flees HP<15% | `hide` x1, `meat` x1 |
| `bandit.weak` | 35 | 8 | normal | patrols; flees HP<30% | `gold` 1–3 |
| `bandit.strong` | 55 | 16 | normal | chases; steals 10–25 gold/hit | `gold` 3–8 + `carriedGold`, `wooden_sword` 10% |
| `giant_spider.weak` | 30 | 7 | normal | wanders; chases on sight | `silk` x1 |
| `giant_spider.venomous` | 50 | 14 | normal | chases; poisons on hit | `silk` x1, `poison_sac` 60% |
| `goblin_scout.weak` | 20 | 5 | fast | flees if outnumbered | `fiber` x1 |
| `goblin_scout.strong` | 35 | 10 | fast | chases; calls allies; steals 3–8 gold/hit | `gold` 1–5 + `carriedGold`, `fiber` x1 |
| `treant.strong` | 120 | 20 | slow | patrols; limited chase (3 tiles) | `ancient_wood` x2, `mushroom` x2 |
| `river_troll.weak` | 60 | 12 | normal | wanders near water | `stone` x2 |
| `river_troll.strong` | 100 | 22 | normal | aggressive; limited chase | `stone` x2, `gold` 2–8 |
| `crocodile.weak` | 45 | 10 | normal | ambush (idle until player adjacent) | `hide` x1, `meat` x1 |
| `water_spirit.weak` | 25 | 8 | fast | flees; only attacks if cornered | `gold` 1–4 |
| `water_spirit.enraged` | 50 | 18 | fast | chases relentlessly | `crystal` 40%, `gold` 2–6 |
| `scorpion.weak` | 25 | 10 | fast | chases; basic attack | `chitin` x1 |
| `scorpion.giant` | 55 | 20 | fast | chases; poisons on hit | `chitin` x2, `poison_sac` 70% |
| `sand_worm.weak` | 80 | 15 | slow | burrows; surfaces near player | `chitin` x2 |
| `mummy.weak` | 45 | 12 | slow | wanders; chases on sight | `linen` x1 |
| `desert_bandit.strong` | 60 | 18 | normal | chases; steals 15–35 gold/hit | `gold` 3–10 + `carriedGold`, `iron_ore` x1 |
| `thief.weak` | 30 | 7 | fast | steals 5–15 gold then flees; gold lost if escape | `gold` 5–10 + `carriedGold` |
| `dark_mage.weak` | 40 | 14 | normal | keeps distance; ranged spell | `mana_crystal` x1 |
| `dark_mage.strong` | 60 | 22 | normal | keeps distance; AOE spell | `mana_crystal` x1, `spell_scroll` 25% |
| `skeleton.weak` | 35 | 9 | normal | patrol; chases on sight | `bone` x1 |
| `slime.weak` | 20 | 4 | slow | flees player | `slime_gel` x1 |
| `slime.corrosive` | 35 | 10 | slow | chases; corrodes armour | `slime_gel` x1 |
| `zombie.weak` | 45 | 8 | slow | wanders; chases slowly | `rotten_flesh` x1 |
| `zombie.armoured` | 70 | 14 | slow | chases; high defence | `rotten_flesh` x1, `gold` 2–5 |
| `dark_knight.weak` | 70 | 18 | normal | patrols; chases on sight | `iron_ingot` x1, `gold` 5–10 |
| `dark_knight.elite` | 110 | 30 | normal | chases; never flees; heavy hit | `iron_ingot` x2, `gold` 10–20, `iron_sword` 15% |
| `ghost.weak` | 45 | 14 | fast | drifts; ignores walls | `ectoplasm` x1 |
| `ghost.enraged` | 70 | 24 | fast | charges player; ignores walls | `ectoplasm` x2, `mana_crystal` 40% |
| `necromancer.weak` | 55 | 20 | normal | ranged; keeps distance | `spell_scroll` x1 |
| `necromancer.strong` | 80 | 30 | normal | ranged; re-spawns skeletons | `spell_scroll` x1, `dark_robe` 25% |
| `dungeon_boss.strong` | 500 | 50 | normal | room lock; phase-based attack | `boss_key` x1, `rare_weapon` 100%, `gold` 200–400 |

**Special flags still apply per variant:**
- `ghost.*` → `special: ['ignores_walls']` — passable through `dungeon_wall`; immune to physical weapons
- `dungeon_boss.strong` → `special: ['room_lock', 'phase_attack']`
- `necromancer.strong` → `special: ['summons_skeletons']`
- `slime.corrosive` → `special: ['corrodes_armor']`
- `thief.weak`, `bandit.strong`, `desert_bandit.strong`, `goblin_scout.strong` → `special: ['steals_gold']` — `Combat.ts` checks this flag after each hit and calls `goldSteal(attacker, defender)`

### Step 5.4 — Pathfinding (`src/world/Pathfinder.ts`)
- A* on loaded chunk cells using `isPassable`
- Fallback to random walk if target unreachable
- Cache paths; recalculate on obstacle change

---

## Phase 6 — Distributed Script Execution

### Step 6.1 — Executor assignment (`src/scripting/ExecutorAssigner.ts`)
- Each online player maintains a list of entities within `MAX_EXEC_DISTANCE` tiles (configurable, default 30)
- On player connect / position change: write `executingPlayerId = localPlayerId` to `/entities/npcs/{id}` and `/entities/enemies/{id}` for each nearby entity whose `executingPlayerId` is null or belongs to an offline player
- On player disconnect: `onDisconnect` clears `executingPlayerId` for all entities assigned to them (reads assigned list from `/presence/{room}`)
- Firebase listener on `/entities/npcs` and `/entities/enemies` filtered by `executingPlayerId === localPlayerId` — only execute scripts for owned entities

### Step 6.2 — Python scripting engine (`src/scripting/ScriptEngine.ts`)
- Load Pyodide once on app start; expose JS↔Python bridge
- `runScript(entityId, script, context)` → executes script, collects returned actions, applies them via Firebase writes
- Sandbox: no file/network access; timeout after 100 ms
- Script source comes from the entity instance's `script` field, which was copied from the template variant at spawn time

**Exposed Python API:**
```python
entity   # dict — full entity state (hp, maxHp, mp, maxMp, power, x, y, state, memory, ...)
world    # read-only helpers:
         #   world.nearestPlayer(entity, radius)        → player dict or None
         #   world.nearbyPlayers(entity, radius)        → list of player dicts within radius
         #   world.nearbyEnemies(entity, radius)        → list of enemy dicts
         #   world.nearbyNpcs(entity, radius)           → list of NPC dicts
         #   world.nearbyDead(entity, baseType, radius) → list of dead entity dicts
         #   world.adjacent(entity, other)              → bool
         #   world.isPassable(x, y)                     → bool
         #   world.getPOIs(type=None)                   → dict from config/pois
         #     type filters: 'dungeons', 'villages', 'bosses', 'treasures'
         #     returns all POI types if type is None
actions  # write helpers:
         #   actions.move(dx, dy)
         #   actions.attack(targetId)
         #   actions.speak(text)               # writes to NPC dialog; nearby players see it
         #   actions.setState(state)
         #   actions.revive(entityId)          # necromancer only
         #   actions.heal(playerId, hp, mp)    # healer only — clamps to maxHp / maxMp
         #   actions.openShop(villageId)       # merchant only — opens ShopScene on the nearest player's client
         #   actions.stealGold(playerId, amount) # steals_gold enemies — Combat.ts calls this; clamps to player.gold
memory   # dict — persisted across ticks in entity.memory (Firebase)
```

**Variant script examples:**

`wolf.weak` — flees on sight:
```python
player = world.nearestPlayer(entity, radius=8)
if player:
    dx = entity['x'] - player['x']
    dy = entity['y'] - player['y']
    actions.move(1 if dx >= 0 else -1, 1 if dy >= 0 else -1)
    actions.setState('flee')
else:
    actions.setState('idle')
    actions.move(0, 0)
```

`wolf.strong` — chases and attacks:
```python
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if entity['hp'] / entity['maxHp'] < 0.15:
        actions.setState('flee')
        dx = entity['x'] - player['x']
        dy = entity['y'] - player['y']
        actions.move(1 if dx >= 0 else -1, 1 if dy >= 0 else -1)
    elif world.adjacent(entity, player):
        actions.setState('attack')
        actions.attack(player['id'])
    else:
        actions.setState('chase')
        actions.move(
            1 if player['x'] > entity['x'] else -1,
            1 if player['y'] > entity['y'] else -1
        )
else:
    actions.setState('patrol')
    actions.move(memory.get('dx', 1), 0)
```

`slime.weak` — runs away:
```python
player = world.nearestPlayer(entity, radius=6)
if player:
    actions.setState('flee')
    actions.move(
        1 if entity['x'] >= player['x'] else -1,
        1 if entity['y'] >= player['y'] else -1
    )
else:
    actions.setState('idle')
```

`slime.corrosive` — chases and corrodes:
```python
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if world.adjacent(entity, player):
        actions.setState('attack')
        actions.attack(player['id'])   # Combat.ts applies corrodes_armor on hit
    else:
        actions.setState('chase')
        actions.move(
            1 if player['x'] > entity['x'] else -1,
            1 if player['y'] > entity['y'] else -1
        )
else:
    actions.setState('patrol')
```

`necromancer.strong` — ranged attack + re-spawns skeletons:
```python
import time
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if not world.adjacent(entity, player):
        actions.setState('attack')
        actions.attack(player['id'])   # ranged — Combat.ts checks weaponType
    else:
        # keep distance
        dx = entity['x'] - player['x']
        dy = entity['y'] - player['y']
        actions.move(1 if dx >= 0 else -1, 1 if dy >= 0 else -1)

    # re-spawn nearby dead skeletons every 10 s
    last_revive = memory.get('last_revive', 0)
    now = time.time()
    if now - last_revive > 10:
        dead = world.nearbyDead(entity, 'skeleton', radius=5)
        for d in dead[:2]:
            actions.revive(d['id'])
        memory['last_revive'] = now
```

### Step 6.3 — Tick loop (`src/scripting/ScriptTicker.ts`)
- Per assigned entity: run script every N ms (configurable per entity type, default: NPC 2000ms, enemy 500ms, offline player 5000ms)
- Batch Firebase writes to minimize round-trips

---

## Phase 7 — Combat System

### Step 7.1 — Combat resolution (`src/combat/Combat.ts`)
- `attack(attacker, defender)`:
  - `damage = max(1, attacker.power - defender.totalDefense)`
    where `totalDefense = endurance * 0.5 + sum of all equipped armor defense values`
  - Write new HP to defender's Firebase cell entry
  - If `hp <= 0` → trigger death handler
  - Post-hit special effects (resolved in order):
    - `lifesteal` (shadow armor pieces) — attacker heals `damage × 0.05` per piece equipped
    - `corrodes_armor` (slime.corrosive) — reduce `defender.totalDefense` by 1 (min 0) until combat ends
    - `steals_gold` (thief/bandit variants) — call `goldSteal(attacker, defender)` after damage is applied (see Step 7.5)

### Step 7.2 — Player death
- Drop inventory items as loot in current cell
- Respawn at house position (or world origin) with 50% HP
- No permanent death — player JSON persists

### Step 7.3 — PVP (level 10+)
- Check `attacker.level >= 10 && defender.level >= 10` before allowing player-on-player attacks
- PVP flag toggle optional (future)

### Step 7.4 — Loot and gold collection (`src/combat/LootHandler.ts`)

**Enemy death drops:**
- For each `lootTable` entry: roll chance, compute quantity, write item to `/presence/{room}/loot/{uuid}` with `{ x, y, items: [...], gold: 0 }`
- Special case: if `itemId === 'gold'`, the rolled amount is written as `{ type: 'gold', amount: N }` — not as an inventory item
- Enemy's `carriedGold` (stolen from players) is always added to the loot pile, merged with any `'gold'` loot entry

**Chest loot:**
- Chests store a `metadata` object set at generation: `{ gold: N, items: [...] }`
- On player interaction (press E adjacent to chest): gold goes to `player.gold`, items go to `player.inventory`; chest becomes `metadata.opened: true` (no further loot)

| Chest type | Gold range | Notes |
|---|---|---|
| World `chest` (overworld) | 10–50 | Seeded from `worldSeed + x * 41 + y * 67` |
| `dungeon_chest` floor 1 | 20–80 | Plus 1–2 item rolls from zone loot table |
| `dungeon_chest` floor 2+ | 40–150 | Plus 2–3 item rolls |
| Boss room loot | 200–400 | `dungeon_boss` death also drops `boss_key`, `rare_weapon` |

**Gold pickup auto-collect:**
- Gold loot entities (`{ type: 'gold', amount }`) at a cell are auto-collected when any player steps on the cell
- Write `player.gold += amount`; remove loot entry from Firebase
- Chat panel shows: *"+12 gold"* system notification

**Gold from selling:**
- Handled by `ShopManager.sell(playerId, itemId, quantity)` — writes `player.gold += sellPrice` to Firebase atomically

### Step 7.5 — Gold stealing (`src/combat/GoldSteal.ts`)

`goldSteal(attacker: EnemyInstance, defender: PlayerInstance)` is called by `Combat.ts` after any hit where `attacker.special.includes('steals_gold')`:

```typescript
function goldSteal(attacker: EnemyInstance, defender: PlayerInstance): void {
  const def = EnemyRegistry.get(attacker.templateId)
  const [min, max] = def.stealGold!
  const amount = Math.min(
    randInt(min, max),
    defender.gold           // cannot go below 0
  )
  if (amount <= 0) return
  // atomic Firebase update: deduct from player, add to enemy
  update(ref(db), {
    [`players/${defender.id}/gold`]:                    increment(-amount),
    [`entities/enemies/${attacker.id}/carriedGold`]:    increment(amount),
  })
  // system chat notification to the victim
  chatNotify(defender.id, `A ${def.displayName} stole ${amount} gold from you!`)
}
```

**Escape detection** — run once per script tick for fleeing enemies with `carriedGold > 0`:
- Compute Chebyshev distance from enemy to nearest player
- If distance > 30 tiles: delete `carriedGold` from Firebase (gold permanently lost); post chat notification *"The thief escaped with your gold!"*

**Python scripts for gold-stealing variants:**

`thief.weak` — steals on first contact, then flees:
```python
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if world.adjacent(entity, player):
        # Combat.ts handles the steal via steals_gold special flag
        actions.attack(player['id'])
    actions.setState('flee')
    dx = entity['x'] - player['x']
    dy = entity['y'] - player['y']
    actions.move(1 if dx >= 0 else -1, 1 if dy >= 0 else -1)
elif entity.get('carriedGold', 0) > 0:
    # heading home with stolen gold — keep moving away from last known player position
    actions.setState('flee')
    actions.move(memory.get('flee_dx', 1), memory.get('flee_dy', 0))
else:
    actions.setState('patrol')
    actions.move(0, 0)
```

`bandit.strong` — fights and steals each hit, never flees:
```python
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if entity['hp'] / entity['maxHp'] < 0.05:
        # only flees at near-death
        actions.setState('flee')
        actions.move(1 if entity['x'] >= player['x'] else -1,
                     1 if entity['y'] >= player['y'] else -1)
    elif world.adjacent(entity, player):
        actions.setState('attack')
        actions.attack(player['id'])   # steals_gold flag triggers goldSteal in Combat.ts
    else:
        actions.setState('chase')
        actions.move(1 if player['x'] > entity['x'] else -1,
                     1 if player['y'] > entity['y'] else -1)
else:
    actions.setState('patrol')
    actions.move(memory.get('patrol_dx', 1), 0)
    if not memory.get('steps'): memory['steps'] = 0
    memory['steps'] += 1
    if memory['steps'] > 4:
        memory['patrol_dx'] = -memory.get('patrol_dx', 1)
        memory['steps'] = 0
```

---

## Phase 8 — Crafting System

### Step 8.1 — Resource collection

All gathering actions replace the source tile temporarily and regenerate after a timer stored on the cell.

| Action | Source tile(s) | Drops | Becomes | Regen timer |
|---|---|---|---|---|
| Chop | `tree_oak`, `tree_pine` | `wood` x1–3 | `stump` | 120 s |
| Chop | `tree_dead` | `wood` x1, `fiber` x1 | `stump` | 180 s |
| Cut | `bush` | `fiber` x1 | `grass_dark` | 60 s |
| Cut | `cactus` | `fiber` x2 | `sand` | 90 s |
| Cut | `reeds` | `fiber` x2 | `mud` | 60 s |
| Mine | `rock_large`, `moss_rock`, `dry_rock` | `stone` x1–2 | `rock_small` | 240 s |
| Mine | `rock_large` (rare, 10%) | `iron_ore` x1 | `rock_small` | 240 s |
| Mine | `dry_rock` (rare, 15%) | `iron_ore` x1 | `sand` | 240 s |
| Pick | `mushroom` | `mushroom` x1 | `grass_dark` | 300 s |
| Pick | `flower_yellow`, `flower_red` | `flower` x1 | `grass` | 120 s |

### Step 8.2 — Intermediate processing

Some recipes require processed materials that must be made first at the `blacksmith_forge`:

| Process | Input | Output | Station |
|---|---|---|---|
| Smelt | `iron_ore` x3 | `iron_ingot` x1 | `blacksmith_forge` |
| Tan | `hide` x2 + `fiber` x1 | `leather` x1 | `workbench` |
| Brew | `poison_sac` x1 + `mushroom` x1 | `poison_vial` x2 | `workbench` |
| Refine | `sand_crystal` x2 + `stone` x1 | `refined_crystal` x1 | `blacksmith_forge` |

### Step 8.3 — Weapon catalogue and recipes (`src/data/weapons.ts`, `src/data/recipes.ts`)

Weapons are grouped by tier. Each recipe uses only natural materials collected in the world.

#### Tier 1 — Workbench · Forest & Plains · Level 1

| Weapon | Power | Type | Recipe |
|---|---|---|---|
| `wooden_sword` | 8 | melee | `wood` x5 + `fiber` x2 |
| `stone_mace` | 11 | melee | `stone` x4 + `wood` x2 |
| `bone_dagger` | 9 | melee | `bone` x3 + `fiber` x1 |
| `hunting_bow` | 10 | ranged | `wood` x4 + `fiber` x3 + `hide` x2 |
| `wooden_staff` | 7 | magic | `wood` x3 + `mushroom` x2 |
| `stone_pick` | 6 | tool/melee | `stone` x3 + `wood` x2 *(faster mining)* |
| `stone_axe` | 8 | tool/melee | `stone` x3 + `wood` x2 *(faster chopping)* |

#### Tier 2 — Workbench · Desert & River · Level 4

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `chitin_blade` | 15 | melee | — | `chitin` x4 + `stone` x2 |
| `silk_whip` | 13 | melee | hits 2 tiles | `silk` x3 + `wood` x2 |
| `poison_dagger` | 11 | melee | poison on hit | `wood` x3 + `poison_sac` x2 |
| `vine_staff` | 12 | magic | slows target | `ancient_wood` x2 + `mushroom` x3 |
| `crystal_wand` | 14 | magic | — | `crystal` x2 + `wood` x2 |
| `bone_bow` | 13 | ranged | — | `bone` x3 + `fiber` x3 + `wood` x2 |
| `leather_sling` | 10 | ranged | area (3 tiles) | `leather` x2 + `fiber` x2 |

#### Tier 3 — Blacksmith Forge · Metal · Level 8

Requires `iron_ingot` (smelted from `iron_ore`).

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `iron_sword` | 20 | melee | — | `iron_ingot` x4 |
| `iron_axe` | 22 | melee | instant chop | `iron_ingot` x3 + `wood` x1 |
| `iron_spear` | 18 | melee | range 2 tiles | `iron_ingot` x2 + `wood` x3 |
| `iron_bow` | 19 | ranged | — | `iron_ingot` x2 + `fiber` x4 |
| `iron_staff` | 20 | magic | — | `iron_ingot` x2 + `mana_crystal` x1 |
| `sand_lance` | 25 | melee | — | `chitin` x3 + `refined_crystal` x2 |

#### Tier 4 — Dungeon Altar · Rare / Magic · Level 12

Requires materials dropped exclusively inside dungeons.

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `shadow_blade` | 28 | melee | lifesteal 10% | `iron_ingot` x4 + `ectoplasm` x2 |
| `soul_staff` | 26 | magic | AOE burst | `ancient_wood` x2 + `mana_crystal` x3 + `ectoplasm` x1 |
| `dark_bow` | 30 | ranged | pierces enemies | `iron_ingot` x2 + `dark_crystal` x1 + `fiber` x3 |
| `slime_launcher` | 16 | ranged | area + slows | `slime_gel` x5 + `wood` x3 |
| `necro_staff` | 28 | magic | summons skeleton | `bone` x5 + `mana_crystal` x2 + `ectoplasm` x3 |
| `boss_blade` | 35 | melee | — | `boss_key` x1 + `iron_ingot` x6 + `dark_crystal` x2 |

**Weapon definition fields** (from `WeaponDefinition` in Step 1.4):
- `power` feeds directly into `attacker.power` in the combat formula
- `weaponType` controls animation and whether range / MP cost applies
- `specialEffect` is resolved by `Combat.ts` after damage (e.g. apply `poisoned` status for 10 s)
- `levelRequired` is enforced at equip time; items below the player's level requirement are greyed out

### Step 8.4 — Workbench / Forge / Altar UI (CraftScene)
- Opens when player interacts with `workbench`, `blacksmith_forge`, or `dungeon_altar`
- Station context passed in; UI filters `RecipeRegistry.getAll()` by `recipe.station` — covers both weapons **and armors**
- Recipes within the player's level are shown; higher-level recipes are visible but locked
- Each recipe card shows: output item icon + name, required materials with live inventory counts (green = enough, red = missing)
- Craft button: validates materials, removes them from inventory, adds weapon/armor, writes to Firebase

### Step 8.5 — Armor catalog (`src/data/armors.ts`)

All armor pieces are `ArmorDefinition` objects. Recipes are `RecipeDefinition` entries with `station` matching the tier.

#### Tier 1 — Workbench · Leather · Level 1

| Armor ID | Slot | Defense | Level | Recipe |
|---|---|---|---|---|
| `leather_helmet` | helmet | 2 | 1 | `hide` ×1 + `fiber` ×2 |
| `leather_chestplate` | chestplate | 4 | 1 | `leather` ×3 + `fiber` ×2 |
| `leather_leggings` | leggings | 3 | 1 | `leather` ×2 + `fiber` ×2 |
| `leather_boots` | boots | 2 | 1 | `leather` ×1 + `fiber` ×2 |
| `leather_gloves` | gloves | 1 | 1 | `hide` ×1 + `fiber` ×1 |

#### Tier 2 — Workbench · Chitin · Level 4

| Armor ID | Slot | Defense | Level | Special | Recipe |
|---|---|---|---|---|---|
| `chitin_helmet` | helmet | 5 | 4 | — | `chitin` ×2 + `leather` ×1 |
| `chitin_chestplate` | chestplate | 9 | 4 | — | `chitin` ×4 + `leather` ×2 |
| `chitin_leggings` | leggings | 7 | 4 | — | `chitin` ×3 + `leather` ×1 |
| `chitin_boots` | boots | 4 | 4 | — | `chitin` ×2 |
| `chitin_gloves` | gloves | 3 | 4 | — | `chitin` ×1 + `fiber` ×1 |

#### Tier 3 — Blacksmith Forge · Iron · Level 8

| Armor ID | Slot | Defense | Level | Special | Recipe |
|---|---|---|---|---|---|
| `iron_helmet` | helmet | 8 | 8 | — | `iron_ingot` ×2 |
| `iron_chestplate` | chestplate | 14 | 8 | — | `iron_ingot` ×5 |
| `iron_leggings` | leggings | 11 | 8 | — | `iron_ingot` ×4 |
| `iron_boots` | boots | 7 | 8 | — | `iron_ingot` ×2 |
| `iron_gloves` | gloves | 5 | 8 | — | `iron_ingot` ×1 + `leather` ×1 |

#### Tier 4 — Dungeon Altar · Shadow · Level 12

| Armor ID | Slot | Defense | Level | Special | Recipe |
|---|---|---|---|---|---|
| `shadow_helmet` | helmet | 12 | 12 | `lifesteal` 5% | `ectoplasm` ×2 + `iron_ingot` ×2 |
| `shadow_chestplate` | chestplate | 20 | 12 | `lifesteal` 5% | `ectoplasm` ×4 + `iron_ingot` ×3 |
| `shadow_leggings` | leggings | 16 | 12 | — | `ectoplasm` ×3 + `iron_ingot` ×2 |
| `shadow_boots` | boots | 10 | 12 | `speed_boost` | `ectoplasm` ×2 + `iron_ingot` ×1 |
| `shadow_gloves` | gloves | 8 | 12 | `power_bonus` +5 | `ectoplasm` ×2 + `dark_crystal` ×1 |

### Step 8.6 — Village Shop system (`src/shop/ShopManager.ts` + `ShopScene`)

**ShopManager** computes a per-village price list at runtime — nothing is stored in Firebase except limited-stock quantities.

**Price computation algorithm:**
```typescript
function buildShopPrices(villageId: string, zoneId: string, seed: number): Map<string, number> {
  const rng = seededRng(seed)        // deterministic per village
  const zoneMultipliers = ZONE_MULTIPLIERS[zoneId]  // lookup table below
  return baseStock.map(entry => {
    const category = getItemCategory(entry.itemId)   // 'wood', 'metal', 'chitin', etc.
    const zoneMult  = zoneMultipliers[category] ?? 1.0
    const jitter    = 0.85 + rng() * 0.30             // 0.85–1.15 random range
    return Math.round(entry.baseBuyPrice * zoneMult * jitter)
  })
}
```

**Zone multiplier table** (`ZONE_MULTIPLIERS`):

| Category | Plains | Forest | River | Desert |
|---|---|---|---|---|
| `wood`, `fiber`, `mushroom` | 1.0 | 0.7 | 0.9 | 1.5 |
| `hide`, `meat`, `bone` | 0.9 | 0.8 | 1.1 | 1.0 |
| `stone`, `iron_ore`, `iron_ingot` | 1.0 | 1.15 | 1.0 | 0.9 |
| `chitin`, `poison_sac`, `silk` | 1.1 | 0.95 | 1.0 | 0.75 |
| `sand_crystal`, `refined_crystal` | 1.2 | 1.3 | 1.2 | 0.7 |
| Leather armor | 1.0 | 0.8 | 1.0 | 1.1 |
| Chitin armor | 1.1 | 1.0 | 1.0 | 0.8 |
| Iron armor/weapons | 1.0 | 0.9 | 0.95 | 1.1 |

**Firebase path** (limited-stock tracking only — at `/shops/{villageId}/`):
```
shops/
  {villageId}/
    lastRestock:  number            # Unix timestamp of last daily restock
    limitedStock: { [itemId]: number }
```
Unlimited-stock items (`maxQuantity: -1`) are never written here.

**ShopScene UI:**
- Two-column panel: **Buy** tab (shop → player) and **Sell** tab (player → shop)
- Buy tab: list of all shop items with icon, name, buy price in gold (coloured by zone — cheaper = green, expensive = red), quantity badge for limited-stock items; disabled if player level too low
- Sell tab: player's full inventory; shows sell price (50% of buy price) for each sellable item; player selects quantity
- Transaction: validates player has enough gold / item to sell; atomically updates `players/{id}/inventory` and `players/{id}/gold` in a single multi-path `update()`

---

## Phase 9 — UI / HUD

### Step 9.1 — HUD (UIScene overlay)
- HP bar (red), MP bar (blue), XP bar (yellow)
- Level badge
- Mini-map (fog-of-war, 50×50 tile grid of visited cells)
- Quick-slot bar (4 slots)

### Step 9.2 — Inventory panel
- Grid display of items with icons and quantities
- Right-click context menu: equip, drop, use

### Step 9.3 — Dialog box
- NPC speech rendered as styled text box over game
- Player response options as buttons

### Step 9.4 — Proximity chat and notifications

**Proximity chat** (`src/chat/ChatManager.ts`):
- When a player sends a message it is written to `/chat/{room}/{timestamp}` with fields `{ playerId, name, x, y, text, timestamp }`
- Every online client subscribes to `/chat/{room}` ordered by timestamp (last 100 entries)
- On receipt, client-side filter: **only display messages from players within 15 tiles** of the local player's current position — messages from far-away players are silently ignored
- Inside dungeon rooms the full room is small enough that all messages in the same room are shown regardless of tile distance
- Messages older than 5 minutes are pruned client-side; the first client to notice trims entries beyond the last 100

**Chat UI** (inside UIScene):
- Text input box at the bottom of the screen; press Enter to send
- Chat history panel (collapsible) shows the last 20 visible messages with player name, timestamp, and text
- NPC `actions.speak(text)` messages appear in the chat panel with the NPC's name in a distinct colour
- System notifications also feed into the panel: level up, item found, player death, player joins/leaves range

**Firebase path:** `/chat/{room}/{timestamp}` — room key: `"0"` for overworld, `"dungeon_{id}_floor_{n}"` for dungeon floors, `"house_{playerId}"` for house interiors. Structure per message:
```
chat/
  {room}/
    {timestamp}/
      playerId:  string
      name:      string
      x:         number
      y:         number
      text:      string
      timestamp: number
```

---

## Phase 10 — Polish & Integration

### Step 10.1 — Sound
- Ambient loop (forest, dungeon)
- SFX: walk, attack, level-up, collect item (Web Audio API via Phaser)

### Step 10.2 — Performance
- Throttle Firebase subscriptions — only subscribe to visible cells
- Pool entity sprites; reuse on move
- Pyodide script execution off main thread via Web Worker

### Step 10.3 — Firebase security rules

All collections require Firebase Anonymous Auth to read or write. Anonymous Auth is the only gate needed — the game manages its own player identity via name + SHA-256 password, independent of the Firebase UID.

**Why not `auth.uid === $playerId`:** The game assigns player IDs via `crypto.randomUUID()`, which is unrelated to the anonymous auth UID. Scoping writes to `auth.uid === $playerId` would always deny writes after the first request. `auth != null` is the correct gate here.

```json
{
  "rules": {
    "config": {
      ".read":  "auth != null",
      ".write": false
    },
    "map": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "players": {
      "$playerId": {
        ".read":  "auth != null",
        ".write": "auth != null"
      }
    },
    "entities": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "presence": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "chat": {
      ".read":  "auth != null",
      ".write": "auth != null"
    },
    "shops": {
      ".read":  "auth != null",
      ".write": "auth != null"
    }
  }
}
```

- `/config` is read-only for all clients — only changed via Firebase Console or admin script
- `/players/{id}` write is scoped to the owning UID — other clients cannot overwrite your stats or gold
- `/entities` and `/presence` are writable by any authenticated client (needed for the distributed script executor)

### Step 10.4 — Production build preparation
- Create `.env.production` with all Firebase config keys (never commit to git — add to `.gitignore`)
- Set `base: '/'` in `vite.config.ts` (root domain deployment)
- Run `npm run build` → verify `dist/` is generated without errors
- See **Phase 11** for amen.pt upload steps

---

## Phase 11 — Publish to amen.pt

Amen.pt uses **WePanel** (Linux shared hosting). The build output is a fully static site — `dist/` contents go directly into `public_html/`.

### Step 11.1 — Vite build for production

```powershell
npm run build
```

Output: `dist/` folder containing `index.html`, JS chunks, CSS, and assets.

> **Pyodide note:** Pyodide (~8 MB WASM) is loaded from the official CDN at runtime — it is **not** bundled into `dist/`. No special handling needed.

### Step 11.2 — Add `.htaccess` to the build

Phaser manages all scene transitions internally so no URL rewriting is needed. However, add this file to prevent directory listing and ensure `index.html` is served at the root:

Create `public/.htaccess` (Vite copies `public/` contents into `dist/` automatically):

```apache
Options -Indexes
DirectoryIndex index.html
```

### Step 11.3 — Connect to amen.pt WePanel

1. Log in at `https://controlpanel.amen.pt`
2. Select your domain under **OS SEUS PRODUTOS**
3. Click the hosting icon to open **WePanel**

### Step 11.4 — Deploy via FTP (recommended for Vite builds)

**Create FTP account in WePanel:**
1. Go to **FTP** section in WePanel
2. Create a new account:
   - Username: `deploy` (or any name)
   - Password: strong password
   - Base Path: `/public_html`
3. Note the FTP host shown after creation (typically `ftp.yourdomain.com`)

**Upload with FileZilla:**
1. Host: `ftp.yourdomain.com` | Port: `21` | Protocol: FTP (or SFTP on port 22)
2. Remote path: `/public_html/`
3. Delete any existing placeholder `index.html` in `public_html/`
4. Upload the **contents** of `dist/` (not the folder itself) into `public_html/`

**Automate with `ftp-deploy` (optional):**

```powershell
npm install --save-dev ftp-deploy
```

Add to `package.json` scripts:
```json
"deploy": "ftp-deploy"
```

Create `.ftp-deploy-config.json` (add to `.gitignore`):
```json
{
  "user": "your-ftp-user",
  "password": "your-ftp-password",
  "host": "ftp.yourdomain.com",
  "port": 21,
  "localRoot": "./dist",
  "remoteRoot": "/public_html/",
  "include": ["*", "**/*"],
  "deleteRemote": false,
  "forcePasv": true
}
```

Then deploy with:
```powershell
npm run build && npm run deploy
```

### Step 11.5 — Deploy via SSH/SCP (alternative — faster for large re-deploys)

1. In WePanel → **SSH** section → enable SSH and generate/authorize a key
2. Download the private key file
3. From PowerShell:

```powershell
# Upload dist/ contents to public_html/
scp -i C:\path\to\private_key -r .\dist\* user@your-server:public_html/
```

### Step 11.6 — Enable SSL in WePanel

1. In WePanel → **SSL** section
2. Select your domain and click **Activate** (Let's Encrypt — free, auto-renews)
3. Wait ~2 minutes for provisioning
4. Verify at `https://yourdomain.com`

### Step 11.7 — Update Firebase Authorized Domains

Firebase blocks requests from unlisted domains by default.

1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. **Authentication** → **Settings** → **Authorized domains**
3. Add `yourdomain.com` and `www.yourdomain.com`
4. Also update Firebase Realtime Database rules to allow reads/writes from the production origin if using domain restrictions

### Step 11.8 — Smoke test checklist

- [ ] `https://yourdomain.com` loads the game canvas
- [ ] Login screen appears; create a test player
- [ ] Map generates and tiles render
- [ ] Player moves and position persists in Firebase
- [ ] Reload page → login with same credentials → player at correct position
- [ ] Console shows no Firebase permission errors
- [ ] SSL padlock is green

---

## Implementation Order (Recommended)

1. **Phase 1** — Scaffold + Firebase schema
2. **Phase 2** — World gen + chunk loading (headless test)
3. **Phase 3** — Phaser renderer with static tiles
4. **Phase 4** — Player login + movement + stats
5. **Phase 5** — NPC/Enemy state machines (JS only first)
6. **Phase 7** — Combat system
7. **Phase 8** — Resource collection + crafting
8. **Phase 6** — Python scripting engine + executor assignment
9. **Phase 9** — Full UI/HUD
10. **Phase 10** — Polish + security rules
11. **Phase 11** — Publish to amen.pt

---

## Key Risk Areas

| Risk | Mitigation |
|---|---|
| Firebase write conflicts on shared cells | Use Firebase transactions for all cell mutations |
| Pyodide load time (~5MB WASM) | Load in background; show loading screen |
| Script executor churn when players move | Debounce executor reassignment (500ms delay) |
| Map storage cost (up to 1M cells) | Only persist visited cells; unvisited cells are computed from noise on demand |
| Python sandbox escapes | Run Pyodide in a Web Worker with no DOM access |

---

## Phase 12 — Extension Guide

The registry architecture (Step 1.4) means adding any content type follows the same pattern and requires zero engine changes.

---

### How to add a new tile

1. **Add sprite frame** to the tileset image and note the frame name
2. **Add a `TileDefinition`** to `src/data/tiles.ts`:
```typescript
{
  id: 'crystal_floor',
  passable: true,
  speedMod: 1.0,
  destructible: false,
  spriteFrame: 'crystal_floor',
  ambientSound: 'shimmer_loop'
}
```
3. **If the tile can be gathered**, add `gatherAction`, `dropTable`, `becomesOnGather`, `regenSeconds`
4. **If the tile blocks movement**, set `passable: false` — `isPassable()` reads from the registry automatically
5. **If the tile is zone-specific**, add its id to the `tileProbabilities` map in the relevant `ZoneDefinition`
6. Rebuild — tile appears in world generation, rendering, and collision without further changes

---

### How to add a new enemy (or a new profile of an existing enemy)

An enemy needs at least one profile, but there is no naming convention — use any label that describes the behaviour (`aggressive`, `coward`, `typeA`, `special1`, etc.).

1. **Add sprite frame(s)** to the enemy sprite sheet (one frame per `baseType` is enough; variants share it unless you add a dedicated frame)
2. **Write a Python behaviour script** for each variant — copy the closest existing script and adjust the flee/attack logic
3. **Add `EnemyDefinition` entries** to `src/data/enemies.ts` — one per profile (profile names are arbitrary). Add `stealGold: [min, max]` and `special: ['steals_gold']` if the variant should steal gold on hit — `Combat.ts` handles the rest automatically:

```typescript
// cave_bat.coward — flees player
{
  id: 'cave_bat.coward',
  baseType: 'cave_bat',
  variant: 'coward',
  displayName: 'Cave Bat',
  baseHp: 15, basePower: 4, baseMp: 0,
  aggroRange: 6,
  speed: 'fast',
  levelRange: [1, 4],
  lootTable: [{ itemId: 'bone', min: 1, max: 1, chance: 0.4 }],
  behaviorScript: `
player = world.nearestPlayer(entity, radius=6)
if player:
    actions.setState('flee')
    actions.move(1 if entity['x'] >= player['x'] else -1,
                 1 if entity['y'] >= player['y'] else -1)
`,
  spriteFrame: 'cave_bat'
},

// cave_bat.aggressive — dives at player
{
  id: 'cave_bat.aggressive',
  baseType: 'cave_bat',
  variant: 'aggressive',
  displayName: 'Cave Bat',
  baseHp: 28, basePower: 10, baseMp: 0,
  aggroRange: 8,
  speed: 'fast',
  levelRange: [3, 7],
  lootTable: [{ itemId: 'bone', min: 1, max: 1, chance: 0.6 },
              { itemId: 'hide', min: 1, max: 1, chance: 0.3 }],
  behaviorScript: `
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    if world.adjacent(entity, player):
        actions.attack(player['id'])
    else:
        actions.setState('chase')
        actions.move(1 if player['x'] > entity['x'] else -1,
                     1 if player['y'] > entity['y'] else -1)
else:
    actions.setState('patrol')
`,
  spriteFrame: 'cave_bat'
},

// cave_bat.special1 — swoops in groups (calls nearby bats)
{
  id: 'cave_bat.special1',
  baseType: 'cave_bat',
  variant: 'special1',
  displayName: 'Cave Bat',
  baseHp: 22, basePower: 8, baseMp: 0,
  aggroRange: 10,
  speed: 'fast',
  levelRange: [2, 6],
  lootTable: [{ itemId: 'bone', min: 1, max: 2, chance: 0.5 }],
  behaviorScript: `
player = world.nearestPlayer(entity, radius=entity['aggroRange'])
if player:
    # alert nearby bats before charging
    nearby = world.nearbyEnemies(entity, radius=5)
    for ally in nearby:
        if ally['baseType'] == 'cave_bat' and ally['state'] == 'idle':
            actions.speak('SCREECH')   # triggers aggro in allies via their scripts
    if world.adjacent(entity, player):
        actions.attack(player['id'])
    else:
        actions.setState('chase')
        actions.move(1 if player['x'] > entity['x'] else -1,
                     1 if player['y'] > entity['y'] else -1)
`,
  spriteFrame: 'cave_bat'
}
```

4. **Add profiles to the zone spawn table** — in `src/data/zones.ts`, add entries with any weights you need:
```typescript
{ id: 'cave_bat.coward',     weight: 50 },
{ id: 'cave_bat.aggressive', weight: 30 },
{ id: 'cave_bat.special1',   weight: 20 },
```
5. No `SpawnManager` or `Combat` changes needed — the variant id flows through the whole system automatically

---

### How to add a new NPC profile

1. **Write the Python behaviour script** — scripts have access to the full Python API (`world`, `actions`, `memory`); copy the nearest existing NPC profile as a starting point
2. **Add an `NpcDefinition`** to `src/data/npcs.ts`:
```typescript
{
  id: 'villager.herbalist',
  baseType: 'villager',
  variant: 'herbalist',
  displayName: 'Villager',
  spriteFrame: 'villager',
  behaviorScript: `
import random
player = world.nearestPlayer(entity, radius=2)
if player:
    actions.speak(random.choice([
        'Mushrooms from the forest can heal minor wounds.',
        'Mix fiber and mushroom at the workbench for a remedy.',
        'Beware the poisonous plants near the dungeon entrance.'
    ]))
    actions.setState('talk')
else:
    actions.setState('wander')
    actions.move(random.choice([-1,0,1]), random.choice([-1,0,1]))
`
}
```
3. **Place the NPC in a village** — add the profile id to the village spawn list in `VillageGen.ts` with a placement rule (e.g. near a garden_plot tile), or push the full `NpcInstance` to `/entities/npcs/{id}` and a presence entry to `/presence/{room}/npcs/{id}` directly for a specific location
4. No other engine changes needed — `NpcRegistry` picks it up at startup and the script executor handles the rest

---

### How to add a new zone

1. **Define noise bounds** — pick `elevationRange` and `moistureRange` values that don't overlap heavily with existing zones, or add a priority order entry in `ZoneMap.ts`
2. **Define tile probabilities** — list tile ids with relative weights:
```typescript
tileProbabilities: { 'crystal_floor': 60, 'crystal_wall': 30, 'dungeon_torch': 10 }
```
3. **Add a `ZoneDefinition`** to `src/data/zones.ts`:
```typescript
{
  id: 'crystal_cave',
  elevationRange: [0.2, 0.4],
  moistureRange: [0.1, 0.3],
  tileProbabilities: { 'crystal_floor': 60, 'crystal_wall': 30 },
  spawnTable: [
    { id: 'cave_bat.weak',          weight: 45 },
    { id: 'cave_bat.strong',        weight: 25 },
    { id: 'crystal_golem.weak',     weight: 20 },
    { id: 'crystal_golem.enraged',  weight: 10 },
  ],
  ambientSound: 'cave_drip',
  musicTrack: 'crystal_theme'
}
```
4. **Tiles and enemies** referenced in the definition must already exist in their registries
5. `ZoneMap.ts` reads `ZoneRegistry.getAll()` at startup — new zone participates in world generation automatically

---

### How to add a new weapon and recipe

1. **Add a `WeaponDefinition`** to `src/data/weapons.ts`:
```typescript
{
  id: 'obsidian_sword',
  name: 'Obsidian Sword',
  category: 'weapon',
  stackable: false, maxStack: 1,
  power: 32,
  weaponType: 'melee',
  levelRequired: 14,
  specialEffect: 'burn',   // apply burning status on hit
  animFrame: 'swing_heavy',
  spriteFrame: 'obsidian_sword'
}
```
2. **Add a `RecipeDefinition`** to `src/data/recipes.ts`:
```typescript
{
  id: 'recipe_obsidian_sword',
  produces: 'obsidian_sword',
  quantity: 1,
  requires: [
    { itemId: 'dark_crystal', qty: 3 },
    { itemId: 'iron_ingot',   qty: 4 },
    { itemId: 'ancient_wood', qty: 2 }
  ],
  station: 'dungeon_altar',
  levelRequired: 14
}
```
3. **Add sprite frame** to the item sprite sheet
4. **If the weapon has a `specialEffect`**, add the effect handler to `Combat.ts` under `applySpecialEffect(effect, attacker, defender)` — the switch-case there is the only engine file that needs touching
5. The `CraftScene` reads `RecipeRegistry.getAll()` filtered by station — the new recipe appears automatically at the dungeon altar

---

### How to add a new armor piece

1. **Add sprite frame** to the item sprite sheet
2. **Add an `ArmorDefinition`** to `src/data/armors.ts`:
```typescript
{
  id: 'bone_helmet',
  name: 'Bone Helmet',
  category: 'armor',
  stackable: false, maxStack: 1,
  armorSlot: 'helmet',
  defense: 6,
  levelRequired: 3,
  spriteFrame: 'bone_helmet'
}
```
3. **Add a `RecipeDefinition`** to `src/data/recipes.ts`:
```typescript
{
  id: 'recipe_bone_helmet',
  produces: 'bone_helmet',
  quantity: 1,
  requires: [{ itemId: 'bone', qty: 4 }, { itemId: 'fiber', qty: 2 }],
  station: 'workbench',
  levelRequired: 3
}
```
4. **Add to shop stock** (optional) — add an entry in `src/data/shop.ts` with `baseBuyPrice` and `maxQuantity`; `ShopManager` picks it up automatically
5. **If it has a `specialEffect`**, add the handler to `Stats.ts` under `applyArmorEffect(effect, player)` and to `Combat.ts` under `applySpecialEffect`
6. `ArmorRegistry` and `CraftScene` pick it up at startup — no other engine changes

---

### How to push content updates live (without redeployment)

For content that must go live without a new build, write definitions directly to Firebase:

```typescript
// Push a new enemy definition to Firebase (admin script or browser console)
set(ref(db, 'config/extensions/enemies/cave_bat'), caveBatDefinition)
```

On next app load, `bootstrap.ts` merges `config/extensions` into the registries after loading built-in definitions. Firebase-sourced definitions override built-in ones with the same `id`, allowing hotfixes without a redeploy.