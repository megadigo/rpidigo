# RPG Game Implementation Plan

## Overview

A multiplayer browser-based RPG with a 1000×1000 bounded world that is generated in full at world initialization, Firebase persistence, distributed NPC/enemy script execution, and Python-scriptable entity behaviors. No dedicated server — all clients connect directly to Firebase.

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
| Map generation | `simplex-noise` library | Seeded random 1000×1000 world generated once at bootstrap, then persisted |
| Build tool | Vite | Fast HMR, TypeScript support |

---

## Phases

This is the **authoritative implementation order**. Each phase must end with a playable build. The detailed sections below follow the same phase order.

### Phase 1 — Project Scaffold & Firebase Setup
- Includes: Steps `1.1` to `1.4`
- Scope: project init, Firebase init, schema design, registries
- End-of-phase outcome: the app boots, connects to Firebase, and the core data model is ready

### Phase 2 — Sprite File Preparation
- Includes: Step `3.1`
- Scope: copying source sprites from the graphics directory into `public/assets/sprites/entities/` with stable filenames aligned to entity IDs
- End-of-phase outcome: all sprite files exist under a stable path; Phaser can load them by key without blocking gameplay work

### Phase 3 — Playable World Exploration Slice
- Includes: Steps `2.1` to `2.5`, Steps `3.2` to `3.6`, and Steps `4.1` to `4.2`
- Scope: full-world generation, world bootstrap, connectivity validation, collision map, Phaser scale config, full scene structure, IntroScene, camera, login with email and champion selection, spawn, player placement, and movement
- End-of-phase outcome: a player reaches the intro screen, registers with an email and a chosen champion, spawns into a valid world, sees the map, and moves around reliably

### Phase 4 — Playable Enemy Combat Slice
- Enemy work comes before NPC work
- Includes: Step `5.1`, Steps `5.3` to `5.4`, Steps `6.1` to `6.3`, and Steps `7.1` to `7.6`
- Scope: enemy templates, pathfinding, nearest-player executor assignment, oldest-update-first scheduler, throttled entity refresh, combat, loot, death/respawn, DeathScene, and gold-stealing logic
- End-of-phase outcome: the player can encounter enemies, die and see the DeathScene, respawn, and the combat loop is playable without overloading the client

### Phase 5 — Playable NPC and Village Slice
- Add NPCs only after the enemy/combat slice is stable
- Includes: Step `5.2`, Step `8.6`, and Steps `9.3` to `9.4`
- Scope: NPC templates, village NPC placement, healer, merchant, gossiper, chat/dialog notifications (DialogScene), and shop interactions
- End-of-phase outcome: villages feel alive, NPCs speak and react, DialogScene and merchant/healer interactions work in-game

### Phase 6 — Playable Progression Slice
- Includes: Steps `4.3` to `4.6` and Steps `8.1` to `8.5`
- Scope: stats, LevelUpScene, inventory, houses, gathering, intermediate processing, crafting stations, weapons, armor, and equipment effects
- End-of-phase outcome: the player can gather resources, manage inventory, craft gear, equip it, and see the LevelUpScene when gaining a level

### Phase 7 — UI, Performance, and Release Prep Slice
- Includes: Steps `9.1` to `9.2` and Steps `10.1` to `10.6`
- Scope: HUD (with mobile layout and zoom controls), inventory panel, PauseScene, MapScene, sound, performance hardening, Firebase security rules, and production build preparation
- End-of-phase outcome: all screens are implemented, the full loop is polished and performant

### Phase 8 — Publish
- Includes: Steps `11.1` to `11.8`
- Scope: amen.pt deployment, SSL, Firebase authorized domains, and smoke tests
- End-of-phase outcome: the game is live in production

---

The sections below are the detailed phase breakdown. Existing step numbers are kept for stability, but the phase order and ownership are defined by the phase headings below.

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
  world:
    status: 'empty' | 'generating' | 'ready'
    generatorPlayerId: string | null
    generatedAt: number
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
*Tile data is generated once during world bootstrap and is never overwritten by generation afterwards. Player modifications (chopped tree → stump, placed house) persist permanently.*

---

#### `/players/{id}` — Canonical player state
```
players/
  {id}/
    id:            string
    name:          string
    email:         string             # stored at registration; used to send account details
    passwordHash:  string             # SHA-256
    championId:    string             # chosen champion e.g. 'arthax' — sprite: '{championId}.png'
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
      templateId:       string        # NpcDefinition id e.g. 'villager_gossiper'
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
      lastLogicAt:      number        # Unix ms — scheduler sorts oldest first
      script:           string
      memory:           {}

  enemies/
    {id}/
      id:               string
      templateId:       string        # EnemyDefinition id e.g. 'wolf_aggressive'
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
      lastLogicAt:      number        # Unix ms — scheduler sorts oldest first
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
  "email": "string",
  "passwordHash": "string",
  "championId": "arthax",
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
  "templateId": "villager_wanderer",
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
  "lastLogicAt": 0,
  "script": "# python behavior script",
  "memory": {}
}
```

`EnemyInstance` (stored at `/entities/enemies/{id}`):
```json
{
  "id": "string",
  "templateId": "wolf_aggressive",
  "baseType": "wolf",
  "variant": "aggressive",
  "hp": 45, "maxHp": 45,
  "mp": 0,  "maxMp": 0,
  "power": 12,
  "room": "0", "x": 0, "y": 0,
  "spawnRoom": "0", "spawnX": 0, "spawnY": 0,
  "state": "idle",
  "executingPlayerId": null,
  "lastLogicAt": 0,
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
  id: string          // format: '{baseType}_{profile}'  e.g. 'wolf_aggressive', 'slime_typeA', 'goblin_special1'
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
  // id is any valid EnemyDefinition id (e.g. 'wolf_aggressive', 'slime_typeA', 'goblin_special1')
  // weight is relative — wolf_aggressive:70 wolf_berserker:30 means 70% chance of aggressive wolf when a wolf spawns
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

## Phase 3 Details — Playable World Exploration: World Generation

### Step 2.1 — Full-world generator (`src/world/WorldGen.ts`)
- World is a fixed **1000×1000** grid (coordinates 0–999 on each axis)
- On the first world bootstrap, create a random seed if `config/seed` does not exist yet; persist it immediately
- Use `simplex-noise` with that seed to build the **entire overworld and all dungeon floors in memory first**, then write them to Firebase in chunks
- `generateWorld(seed): WorldSnapshot` → returns the full tile map, POIs, village layouts, dungeon layouts, roads, bridges, and initial spawn placements
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
- After POI placement, build a road network between villages and their nearest dungeon entrances so the world has a guaranteed passable backbone

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

### Step 2.2 — World bootstrap and persistence (`src/world/WorldBootstrap.ts`)
Because there is no dedicated server, the first online client that finds `config/world/status = 'empty'` is responsible for generating the shared world.

**Bootstrap flow:**
1. Claim generation ownership with a Firebase transaction on `config/world/status`
2. If claimed, generate the full overworld, all villages, all dungeon entrances, and all dungeon floors in memory
3. Run connectivity validation and repair before writing anything permanent
4. Write `/config/seed`, `/config/pois`, `/map/0/*`, all dungeon room maps, NPC instances, enemy instances, and `/shops/*` in chunked batched updates
5. Mark `config/world/status = 'ready'` and set `generatedAt`
6. If another client is already generating, wait until status becomes `ready` and then load the persisted world

**Chunked persistence strategy:**
- Split the overworld write into deterministic chunks (for example 50×50 or 100×100 tile batches)
- Commit each chunk through batched `update()` calls to avoid oversized Firebase payloads
- Persist generation progress only through `config/world/status`; no client should partially regenerate existing chunks

### Step 2.3 — Reachability validation and repair (`src/world/ConnectivityPass.ts`)
The generated map must satisfy the gameplay rule that every major zone and every important POI is reachable.

**Validation targets:**
- Every village POI
- Every dungeon entrance POI
- At least one representative reachable region of `plains`, `forest`, `river`, and `desert`
- Player spawn candidates within the allowed 50-tile world margin

**Repair rules:**
1. Run a flood-fill on passable overworld cells from the main road network
2. If a village or dungeon entrance is unreachable, carve a passable connector using `dirt_path`, `cobblestone`, or `sand_bank` depending on the local zone
3. If a river blocks the connector, place `bridge` tiles at the narrowest valid crossing
4. Clear dense blockers (`tree_*`, `rock_*`, `cactus`) around POIs and along repaired corridors where necessary
5. Re-run validation until all required targets are reachable

### Step 2.4 — Zone-aware enemy spawning (`src/world/SpawnManager.ts`)
After the full map is generated and validated, spawn enemies from the persisted zone layout using a seeded roll per eligible cell.

**Spawn algorithm:**
1. Look up the zone's `spawnTable` from `ZoneRegistry`
2. Roll spawn chance (seeded by `worldSeed + x * 31 + y * 97` — deterministic, never re-rolls)
3. If spawning, pick a variant by weighted random from `spawnTable` entries
4. Write enemy instance to `/entities/enemies/{enemyId}` and a presence snapshot to `/presence/{room}/enemies/{enemyId}`

**Zone spawn tables** (variant IDs + relative weights):

| Zone | Spawn chance/cell | Spawn table |
|---|---|---|
| Plains | 2% | `wolf_weak` 60, `wolf_strong` 20, `bandit_weak` 15, `bandit_strong` 5 |
| Forest | 4% | `wolf_weak` 40, `wolf_strong` 20, `giant_spider_weak` 20, `goblin_scout_weak` 10, `treant_strong` 5, `giant_spider_venomous` 5 |
| River | 3% | `river_troll_weak` 40, `river_troll_strong` 20, `crocodile_weak` 25, `water_spirit_weak` 10, `water_spirit_enraged` 5 |
| Desert | 3% | `scorpion_weak` 35, `scorpion_giant` 15, `sand_worm_weak` 20, `mummy_weak` 20, `desert_bandit_strong` 10 |
| Village outskirts | 1% | `thief_weak` 60, `dark_mage_weak` 30, `dark_mage_strong` 10 |
| Dungeon floor 1 | 15%/room | `skeleton_weak` 40, `slime_weak` 30, `slime_corrosive` 10, `zombie_weak` 15, `zombie_armoured` 5 |
| Dungeon floor 2+ | 20%/room | `dark_knight_weak` 30, `dark_knight_elite` 20, `ghost_weak` 25, `ghost_enraged` 10, `necromancer_weak` 10, `necromancer_strong` 5 |
| Dungeon boss room | 100% | `dungeon_boss_strong` 100 |

- Boss room is always one `dungeon_boss_strong` instance — no weight roll needed
- Enemy instance JSON includes `templateId` (the full variant id), `baseType`, and `variant` for fast lookup

### Step 2.5 — Collision map
- Impassable tiles: all `tree_*`, `rock_*`, `moss_rock`, `cactus`, `water_*`, `oasis_water`, `house_wall`, `dungeon_wall`, `dungeon_pillar`, `fence`, `well`, `void`
- `isPassable(x, y)` checks the local cache first, then falls back to the persisted map data for the current room
- Boundary check: `isPassable` returns `false` for any coordinate outside [0, 999]
- Slow-movement tiles (`grass_tall`, `mud`, `quicksand`, `sand_dune`) are passable but apply a movement speed penalty

---

## Phase 2 — Sprite File Preparation

### Step 3.1 — Entity sprite files
- Source sprites are in `graphics/MiniWorldSprites/MiniWorldSprites/` — copy them into `public/assets/sprites/entities/` with flat, stable filenames
- Directory structure:
  - `public/assets/sprites/entities/players/`
  - `public/assets/sprites/entities/npcs/`
  - `public/assets/sprites/entities/enemies/`
- Each file is named after its entity id/profile using underscores; the source graphic is noted in parentheses

**Players** (source: `Characters/Champions/`)

| Destination file | Source |
|---|---|
| `players/player_arthax.png` | `Characters/Champions/Arthax.png` |
| `players/player_borg.png` | `Characters/Champions/Börg.png` |
| `players/player_gangblanc.png` | `Characters/Champions/Gangblanc.png` |
| `players/player_grum.png` | `Characters/Champions/Grum.png` |
| `players/player_kanji.png` | `Characters/Champions/Kanji.png` |
| `players/player_katan.png` | `Characters/Champions/Katan.png` |
| `players/player_okomo.png` | `Characters/Champions/Okomo.png` |
| `players/player_zhinja.png` | `Characters/Champions/Zhinja.png` |

**NPCs**

| Destination file | Source |
|---|---|
| `npcs/villager_wanderer.png` | `Characters/Workers/FarmerTemplate.png` |
| `npcs/villager_hunter.png` | `Characters/Soldiers/Ranged/BowmanTemplate.png` |
| `npcs/villager_fisherman.png` | `Characters/Workers/FarmerTemplate.png` |
| `npcs/villager_gossiper.png` | `Characters/Workers/FarmerTemplate.png` |
| `npcs/healer_standard.png` | `Characters/Soldiers/Ranged/MageTemplate.png` |
| `npcs/merchant_standard.png` | `Characters/Workers/FarmerTemplate.png` |
| `npcs/guard_patrol.png` | `Characters/Soldiers/Melee/SwordsmanTemplate.png` |

**Enemies**

| Destination file | Source |
|---|---|
| `enemies/wolf.png` | `Animals/Boar.png` |
| `enemies/bandit_weak.png` | `Characters/Soldiers/Melee/AssasinTemplate.png` |
| `enemies/bandit_strong.png` | `Characters/Soldiers/Melee/AxemanTemplate.png` |
| `enemies/giant_spider.png` | `Characters/Monsters/GiantAnimals/GiantCrab.png` |
| `enemies/goblin_scout_weak.png` | `Characters/Monsters/Orcs/ArcherGoblin.png` |
| `enemies/goblin_scout_strong.png` | `Characters/Monsters/Orcs/SpearGoblin.png` |
| `enemies/treant.png` | `Characters/Monsters/Orcs/Minotaur.png` |
| `enemies/river_troll.png` | `Characters/Monsters/Orcs/Orc.png` |
| `enemies/crocodile.png` | `Animals/MarineAnimals.png` |
| `enemies/water_spirit.png` | `Characters/Monsters/Demons/PurpleDemon.png` |
| `enemies/scorpion.png` | `Characters/Monsters/GiantAnimals/GiantCrab.png` |
| `enemies/sand_worm.png` | `Characters/Monsters/Orcs/ClubGoblin.png` |
| `enemies/mummy.png` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `enemies/desert_bandit.png` | `Characters/Soldiers/Melee/AssasinTemplate.png` |
| `enemies/thief.png` | `Characters/Soldiers/Melee/AssasinTemplate.png` |
| `enemies/dark_mage_weak.png` | `Characters/Soldiers/Ranged/MageTemplate.png` |
| `enemies/dark_mage_strong.png` | `Characters/Monsters/Orcs/OrcMage.png` |
| `enemies/skeleton.png` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `enemies/slime_weak.png` | `Characters/Monsters/Slimes/Slime.png` |
| `enemies/slime_corrosive.png` | `Characters/Monsters/Slimes/SlimeBlue.png` |
| `enemies/zombie.png` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `enemies/dark_knight_weak.png` | `Characters/Soldiers/Melee/SwordsmanTemplate.png` |
| `enemies/dark_knight_elite.png` | `Characters/Soldiers/Mounted/RedKnight.png` |
| `enemies/ghost.png` | `Characters/Monsters/Demons/PurpleDemon.png` |
| `enemies/necromancer.png` | `Characters/Monsters/Undead/Necromancer.png` |
| `enemies/dungeon_boss_strong.png` | `Characters/Monsters/Dragons/BlackDragon.png` |

- The `spriteFrame` field in each `EnemyDefinition` and `NpcDefinition` references the destination filename (without the directory prefix), e.g. `"wolf.png"`, `"necromancer.png"`
- End of phase requirement: all destination files exist (copied from source); Phaser can load them by key

---

## Phase 3 Details — Playable World Exploration: Rendering

### Step 3.1 — Tileset and assets
- Base tile size is fixed at **16×16** for all world tiles and entity sprites
- **Plains:** `grass`, `grass_tall`, `flower_yellow`, `flower_red`, `dirt_path`, `rock_small`, `rock_large`
- **Forest:** `grass_dark`, `tree_oak`, `tree_pine`, `tree_dead`, `bush`, `mushroom`, `log`, `moss_rock`, `stump`
- **River:** `water_shallow`, `water_deep`, `sand_bank`, `reeds`, `bridge`, `mud`
- **Desert:** `sand`, `sand_dune`, `dry_rock`, `cactus`, `dry_grass`, `oasis_water`, `quicksand`
- **Village:** `cobblestone`, `house_floor`, `house_wall`, `house_door`, `house_roof`, `well`, `fence`, `market_stall`, `blacksmith_forge`, `tavern_sign`, `lantern`, `garden_plot`
- **Dungeon:** `dungeon_entrance`, `dungeon_floor`, `dungeon_wall`, `dungeon_door`, `dungeon_stairs_down`, `dungeon_stairs_up`, `dungeon_torch`, `dungeon_pillar`, `dungeon_trap`, `dungeon_chest`, `dungeon_altar`
- **Special:** `house` (player house entrance), `workbench`, `chest`, `void`

### Step 3.2 — Scene structure

All scenes are Phaser scenes. Additive scenes run simultaneously with `GameScene`; replacement scenes stop the previous scene. Scene classes live in `src/scenes/`.

| Scene | Stacking | Purpose |
|---|---|---|
| `IntroScene` | replacement | Title screen shown once on first page load |
| `LoginScene` | replacement | Name, email, password, and champion selection |
| `LoadingScene` | replacement | Asset preload + world bootstrap progress |
| `GameScene` | replacement | Main gameplay — tilemap + entity sprites |
| `HudScene` | additive | Persistent HP/MP/gold/chat overlay above `GameScene` |
| `InventoryScene` | additive overlay | Item grid, armor slots, equip/drop/use |
| `CraftScene` | additive overlay | Recipe list for workbench, forge, and altar |
| `ShopScene` | additive overlay | Village merchant buy/sell panel |
| `DialogScene` | additive overlay | NPC speech bubbles |
| `MapScene` | additive overlay | Full-screen fog-of-war world map |
| `LevelUpScene` | additive overlay | Stat point distribution on level gain |
| `PauseScene` | additive overlay | Resume / settings / log out |
| `DeathScene` | additive overlay | Death summary + respawn countdown |

### Step 3.3 — Phaser scale config and pixel-art rendering (`src/main.ts`)
```typescript
new Phaser.Game({
  width: 320,
  height: 180,
  pixelArt: true,           // nearest-neighbour upscaling
  scale: {
    mode: Phaser.Scale.FIT, // fill window, preserve 16:9
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  backgroundColor: '#000',
})
```
- Logical resolution **320×180** at 16×16 tiles → 20 tiles wide × ~11 tiles tall visible at 1× zoom
- Default camera zoom **2×**; player can adjust 1×–4× (integer steps) via scroll-wheel / pinch; persisted in `localStorage`
- On viewport width < 640 CSS px: HUD compact layout + on-screen D-pad (see *Viewport & Scaling* in SPEC)

### Step 3.4 — Dynamic tilemap rendering (`src/renderer/TilemapRenderer.ts`)
- Use Phaser's `DynamicTilemapLayer` fed from `ChunkManager`
- Re-render tiles on Firebase cell updates
- Sprite pool for players, NPCs, enemies — reuse on move

### Step 3.5 — Camera
- Follow local player; smooth lerp
- Render depth-sorted sprites (y-sort for top-down feel)
- Clamp camera so it never shows void outside world boundaries (0–999)

### Step 3.6 — IntroScene (`src/scenes/IntroScene.ts`)
- Shown once on first page load before any Firebase or network call
- Full-screen DOM overlay (HTML/CSS) centred over the Phaser canvas; `body { background: #000 }`
- Content: game title (styled text or logo image from `public/assets/ui/title.png`), short tagline, and a **Play** button
- **Play** click: hide overlay, launch `LoginScene`
- No asset preloading required; renders immediately from inlined styles and a single image

---

## Phase 3 Details — Playable World Exploration: Player Login and Movement

### Step 4.1 — Authentication (`src/player/Auth.ts`)
- **Registration (first login):** collect name, email, password, and chosen champion (one of eight); hash password SHA-256 via Web Crypto API; wait for `WorldBootstrap.ensureWorldReady()`; pick a random reachable spawn point; create `PlayerInstance` (including `email` and `championId`); write to Firebase; trigger a welcome email to the provided address containing the player name via a Firebase Cloud Function or a client-side `mailto:` link as fallback
- **Subsequent login:** query `/players` ordered by `name` field, compare hash, load saved state from `/players/{id}`; if credentials fail show error in `LoginScene`
- Set `online: true` on connect; set `online: false` and `lastSeen: serverTimestamp()` via `onDisconnect`

**Random spawn placement (first login only):**
1. Pick random `x = randInt(50, 950)`, `y = randInt(50, 950)` — 50-tile margin keeps spawn away from world edges
2. Verify the chosen cell is passable; re-roll up to 10 times if not
3. Verify the chosen cell belongs to the validated reachable overworld set generated in Phase 2
4. Find the house position: scan up to 5 tiles away from spawn for the nearest `grass` cell; use that as `houseX, houseY`
5. Write the `house` tile to `/map/0/{houseX}_{houseY}` (overwrites the generated `grass`)
6. Write `PlayerInstance` to `/players/{id}` with `room: "0"`, `x`, `y`, `house`
7. Write presence entry to `/presence/0/players/{id}` with `{ x, y, name, level, spriteFrame: player.championId + '.png', state: "idle" }`

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

---

## Phase 6 Details — Playable Progression: Player Growth, Inventory, and Housing

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

### Step 4.6 — LevelUpScene (`src/scenes/LevelUpScene.ts`)
- Additive overlay shown immediately when `player.xp >= xpForLevel(player.level + 1)`
- Blocks further movement and entity script execution until dismissed
- **Content:**
  - “Level Up!” banner with the new level number
  - Four stat rows: Strength, Agility, Intelligence, Endurance — each with current value and a **+** button
  - Unspent points counter (1 stat point per level); **+** buttons disabled when zero points remain
  - Any new recipe or unlock available at this level listed as a brief notification line
  - **Confirm** button (only enabled once all stat points are spent)
- **On Confirm:** write new stats to `players/{id}/stats`, increment `players/{id}/level`, recalculate and write `power` and `totalDefense`, dismiss overlay

---

## Phase 4 Details — Playable Enemy Combat: Entity Foundations and Enemy Logic

### Step 5.1 — State machine base class (`src/entities/StateMachine.ts`)
- Generic FSM: `states: Map<string, StateHandler>`, `currentState`, `transition(newState)`
- `StateHandler = { onEnter?, onTick(dt, entity, world), onExit? }`

### Step 5.2 — NPC states and profiles (`src/entities/NpcTemplate.ts`) [Implemented in Phase 5]

NPCs use the same `{baseType}_{profile}` convention as enemies. Profile names are free-form.

**States:** `idle`, `wander`, `talk`, `follow`, `flee`

**NpcDefinition** (added to `src/data/npcs.ts` and `src/registry/NpcRegistry.ts`):
```typescript
interface NpcDefinition {
  id: string          // '{baseType}_{profile}'  e.g. 'villager_wanderer', 'healer_standard'
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

`villager_wanderer` — roams the village, greets players:
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

`villager_hunter` — patrols the forest edge, talks about game:
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

`villager_fisherman` — stays near river tiles, shares river knowledge:
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

`villager_gossiper` — shares world knowledge: dungeon locations, treasures, boss sightings, village directions:
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

`healer_standard` — restores player HP and MP on approach:
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

`merchant_standard` — greets players and opens the shop:
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
| `villager_wanderer` | 2–4 | Random grass cells in village bounds |
| `villager_hunter` | 1 | Near village edge facing forest |
| `villager_fisherman` | 1 | Adjacent to nearest river or water tile |
| `villager_gossiper` | 1 | Near the central well |
| `healer_standard` | 1 | Inside or adjacent to a house building |
| `merchant_standard` | 1 | At `market_stall` tile |
| `guard_patrol` | 1–2 | At village entry paths |

### Step 5.3 — Enemy states, variants and templates (`src/entities/EnemyTemplate.ts`) [Implemented in Phase 4]
- States: `idle`, `patrol`, `chase`, `attack`, `flee`, `dead`
- Aggro range: if player within N tiles → `chase`
- Attack: if adjacent → deal `power` damage to player, apply cooldown
- `dead` state: drop loot, write loot to cell, remove enemy from Firebase after delay
- Enemy respawn: template stores `respawnTimer` (seconds); re-instantiate at original spawn cell

#### Variant system

Every enemy is identified by `{baseType}_{profile}`. The profile is a **free-form label** — any string is valid: `aggressive`, `typeA`, `special1`, `weak`, `strong`, `berserker`, `enraged`, `spectral`, `boss`, or anything else that describes the behaviour. Each profile is a **separate `EnemyDefinition`** with its own stats and its own Python behaviour script. Profiles of the same `baseType` share a display name and can share a sprite frame.

Rules for profile design:
- There is no required naming convention — use names that describe the behaviour (`aggressive`, `coward`, `healer`, `typeA`) or role (`special1`, `elite`, `miniboss`)
- A `baseType` can have one profile or many — add as many as the game needs
- Stats and the Python script are fully independent per profile; two profiles with identical stats but different scripts are perfectly valid
- The behaviour script is the primary differentiator: one profile may flee, another charge, another call reinforcements

**Example variant pairs:**

`wolf_weak`
- HP 25 · Power 6 · Speed fast
- Script: flees any player on sight; wanders otherwise

`wolf_strong`
- HP 45 · Power 12 · Speed fast
- Script: chases and attacks player; only flees at HP < 15%

`slime_weak`
- HP 20 · Power 4 · Speed slow
- Script: moves away from nearest player; does not attack

`slime_corrosive`
- HP 35 · Power 10 · Speed slow
- Script: actively chases and attacks; applies armour-reduction debuff on hit (via `special: ['corrodes_armor']`)

`necromancer_weak`
- HP 55 · Power 20 · Speed normal
- Script: keeps distance from player; casts ranged spell every 3 s

`necromancer_strong`
- HP 80 · Power 30 · Speed normal
- Script: keeps distance; re-spawns dead skeletons every 10 s via `world.nearbyDead(entity, 'skeleton', radius=5)` + `actions.revive(id)`

---

**Full variant catalogue** (`src/data/enemies.ts`):

| Variant ID | HP | Power | Speed | Behaviour summary | Loot |
|---|---|---|---|---|---|
| `wolf_weak` | 25 | 6 | fast | flees on sight | `hide` x1 |
| `wolf_strong` | 45 | 12 | fast | chases; flees HP<15% | `hide` x1, `meat` x1 |
| `bandit_weak` | 35 | 8 | normal | patrols; flees HP<30% | `gold` 1–3 |
| `bandit_strong` | 55 | 16 | normal | chases; steals 10–25 gold/hit | `gold` 3–8 + `carriedGold`, `wooden_sword` 10% |
| `giant_spider_weak` | 30 | 7 | normal | wanders; chases on sight | `silk` x1 |
| `giant_spider_venomous` | 50 | 14 | normal | chases; poisons on hit | `silk` x1, `poison_sac` 60% |
| `goblin_scout_weak` | 20 | 5 | fast | flees if outnumbered | `fiber` x1 |
| `goblin_scout_strong` | 35 | 10 | fast | chases; calls allies; steals 3–8 gold/hit | `gold` 1–5 + `carriedGold`, `fiber` x1 |
| `treant_strong` | 120 | 20 | slow | patrols; limited chase (3 tiles) | `ancient_wood` x2, `mushroom` x2 |
| `river_troll_weak` | 60 | 12 | normal | wanders near water | `stone` x2 |
| `river_troll_strong` | 100 | 22 | normal | aggressive; limited chase | `stone` x2, `gold` 2–8 |
| `crocodile_weak` | 45 | 10 | normal | ambush (idle until player adjacent) | `hide` x1, `meat` x1 |
| `water_spirit_weak` | 25 | 8 | fast | flees; only attacks if cornered | `gold` 1–4 |
| `water_spirit_enraged` | 50 | 18 | fast | chases relentlessly | `crystal` 40%, `gold` 2–6 |
| `scorpion_weak` | 25 | 10 | fast | chases; basic attack | `chitin` x1 |
| `scorpion_giant` | 55 | 20 | fast | chases; poisons on hit | `chitin` x2, `poison_sac` 70% |
| `sand_worm_weak` | 80 | 15 | slow | burrows; surfaces near player | `chitin` x2 |
| `mummy_weak` | 45 | 12 | slow | wanders; chases on sight | `linen` x1 |
| `desert_bandit_strong` | 60 | 18 | normal | chases; steals 15–35 gold/hit | `gold` 3–10 + `carriedGold`, `iron_ore` x1 |
| `thief_weak` | 30 | 7 | fast | steals 5–15 gold then flees; gold lost if escape | `gold` 5–10 + `carriedGold` |
| `dark_mage_weak` | 40 | 14 | normal | keeps distance; ranged spell | `mana_crystal` x1 |
| `dark_mage_strong` | 60 | 22 | normal | keeps distance; AOE spell | `mana_crystal` x1, `spell_scroll` 25% |
| `skeleton_weak` | 35 | 9 | normal | patrol; chases on sight | `bone` x1 |
| `slime_weak` | 20 | 4 | slow | flees player | `slime_gel` x1 |
| `slime_corrosive` | 35 | 10 | slow | chases; corrodes armour | `slime_gel` x1 |
| `zombie_weak` | 45 | 8 | slow | wanders; chases slowly | `rotten_flesh` x1 |
| `zombie_armoured` | 70 | 14 | slow | chases; high defence | `rotten_flesh` x1, `gold` 2–5 |
| `dark_knight_weak` | 70 | 18 | normal | patrols; chases on sight | `iron_ingot` x1, `gold` 5–10 |
| `dark_knight_elite` | 110 | 30 | normal | chases; never flees; heavy hit | `iron_ingot` x2, `gold` 10–20, `iron_sword` 15% |
| `ghost_weak` | 45 | 14 | fast | drifts; ignores walls | `ectoplasm` x1 |
| `ghost_enraged` | 70 | 24 | fast | charges player; ignores walls | `ectoplasm` x2, `mana_crystal` 40% |
| `necromancer_weak` | 55 | 20 | normal | ranged; keeps distance | `spell_scroll` x1 |
| `necromancer_strong` | 80 | 30 | normal | ranged; re-spawns skeletons | `spell_scroll` x1, `dark_robe` 25% |
| `dungeon_boss_strong` | 500 | 50 | normal | room lock; phase-based attack | `boss_key` x1, `rare_weapon` 100%, `gold` 200–400 |

**Special flags still apply per variant:**
- `ghost_*` → `special: ['ignores_walls']` — passable through `dungeon_wall`; immune to physical weapons
- `dungeon_boss_strong` → `special: ['room_lock', 'phase_attack']`
- `necromancer_strong` → `special: ['summons_skeletons']`
- `slime_corrosive` → `special: ['corrodes_armor']`
- `thief_weak`, `bandit_strong`, `desert_bandit_strong`, `goblin_scout_strong` → `special: ['steals_gold']` — `Combat.ts` checks this flag after each hit and calls `goldSteal(attacker, defender)`

### Step 5.4 — Pathfinding (`src/world/Pathfinder.ts`)
- A* on loaded chunk cells using `isPassable`
- Fallback to random walk if target unreachable
- Cache paths; recalculate on obstacle change

---

## Phase 4 Details — Playable Enemy Combat: Distributed Execution

### Step 6.1 — Executor assignment (`src/scripting/ExecutorAssigner.ts`)
- Each online player maintains a list of entities within `MAX_EXEC_DISTANCE` tiles (configurable, default 30)
- On player connect / position change: compare distance from the entity to all online players in the room; the **nearest player** is the preferred executor
- Claim rules:
  - If `executingPlayerId` is null, the nearest player claims it
  - If the current executor is offline, the nearest online player claims it
  - If another online player becomes strictly nearer than the current executor, ownership may transfer to that nearer player
- Ownership claim writes `executingPlayerId = localPlayerId` only for entities where the local player is the current nearest eligible client
- On player disconnect: `onDisconnect` clears `executingPlayerId` for all entities assigned to them (reads assigned list from `/presence/{room}`)
- Firebase listener on `/entities/npcs` and `/entities/enemies` filtered by `executingPlayerId === localPlayerId` — only execute scripts for locally owned entities
- Keep assignment recalculation debounced (default 500 ms) so movement does not cause constant ownership churn

### Step 6.2 — Python scripting engine (`src/scripting/ScriptEngine.ts`)
- Load Pyodide once on app start; expose JS↔Python bridge
- `runScript(entityId, script, context)` → executes script, collects returned actions, applies them via Firebase writes
- Sandbox: no file/network access; timeout after 100 ms
- Script source comes from the entity instance's `script` field, which was copied from the template variant at spawn time
- After each successful script execution, update `lastLogicAt = serverTimestamp()` on the entity so the scheduler can prioritize the stalest entities first

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

`wolf_weak` — flees on sight:
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

`wolf_strong` — chases and attacks:
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

`slime_weak` — runs away:
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

`slime_corrosive` — chases and corrodes:
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

`necromancer_strong` — ranged attack + re-spawns skeletons:
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
- Maintain a local priority queue of owned entities sorted by `lastLogicAt` ascending (oldest update first)
- On each scheduler slice, only refresh a **small capped batch**:
  - default: up to 4 enemies
  - default: up to 2 NPCs
- Per assigned entity: run script no faster than its minimum interval (default: NPC 2000 ms, enemy 500 ms)
- If the queue is larger than the current cap, leave the remaining entities for the next scheduler slice instead of refreshing everything at once
- Batch Firebase writes to minimize round-trips
- If the frame budget is exceeded locally, stop the current slice early and continue on the next slice

---

## Phase 4 Details — Playable Enemy Combat: Combat Systems

### Step 7.1 — Combat resolution (`src/combat/Combat.ts`)
- `attack(attacker, defender)`:
  - `damage = max(1, attacker.power - defender.totalDefense)`
    where `totalDefense = endurance * 0.5 + sum of all equipped armor defense values`
  - Write new HP to defender's Firebase cell entry
  - If `hp <= 0` → trigger death handler
  - Post-hit special effects (resolved in order):
    - `lifesteal` (shadow armor pieces) — attacker heals `damage × 0.05` per piece equipped
    - `corrodes_armor` (`slime_corrosive`) — reduce `defender.totalDefense` by 1 (min 0) until combat ends
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

`thief_weak` — steals on first contact, then flees:
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

`bandit_strong` — fights and steals each hit, never flees:
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

### Step 7.6 — DeathScene (`src/scenes/DeathScene.ts`)
- Additive overlay launched immediately when `player.hp <= 0` is detected on the local player
- Darkened full-screen vignette over the game world; `GameScene` continues rendering but all player input is disabled
- **Content:**
  - “You Died” title
  - Cause line: *“Killed by [enemy display name / player name]”*
  - Brief summary: gold retained (positive line) and items dropped (listed by name and quantity)
  - **Respawn at House** button
  - Countdown label: *“Auto-respawning in 10…”* (counts down to 0, then auto-fires)
- **On respawn (button or countdown expiry):**
  1. Teleport player to `house.x`, `house.y`, `house.room`
  2. Set `hp = Math.floor(maxHp * 0.5)`
  3. Write room transition to Firebase (remove old presence entry, add new)
  4. Dismiss `DeathScene`

---

## Phase 6 Details — Playable Progression: Gathering, Crafting, and Shops

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

## Phase 5 Details — Playable NPC and Village: Dialog, Chat, and Shop UX

### Step 9.1 — HudScene (`src/scenes/HudScene.ts`)
- Additive scene always stacked over `GameScene`; never stopped during play
- **Top-left:** HP bar (red), MP bar (blue), level badge, XP progress bar, gold counter
- **Top-right:** Mini-map — fog-of-war grid of visited cells (50×50 logical tiles); icons for known villages and dungeon entrances
- **Bottom-right:** equipped weapon icon (quick-slot)
- **Bottom-left:** chat panel — last 20 visible proximity messages; NPC speech in distinct colour; system notifications (level-up, item found, gold stolen, player joins/leaves); collapsible
- **Bottom toolbar (mobile) / HUD edges (desktop):** **Inventory**, **Map**, and **Menu** action buttons
- Scroll-wheel / pinch: adjust camera zoom 1×–4× (integer steps); zoom saved to `localStorage`
- On viewport width < 640 CSS px: compact layout — chat collapses to single-line ticker; mini-map shrinks to 64×64 logical px; on-screen D-pad rendered for touch movement

### Step 9.2 — InventoryScene (`src/scenes/InventoryScene.ts`)
- Additive overlay over `GameScene` + `HudScene`; entity script execution paused while open; player cannot move
- **Left panel:** scrollable grid of inventory slots; each slot shows item icon and stack count; click to select
- **Right panel:** character silhouette with five armour slots (helmet, chestplate, leggings, boots, gloves) and one weapon slot rendered as labelled zones; click a filled slot to unequip and return the item to the inventory grid
- **Item tooltip (selected):** item name, power/defense, level requirement, special effect
- **Action buttons on selected item:** **Equip** (validates slot and level), **Drop** (spawns loot at player's feet), **Use** (consumables only)
- **Close** / ESC to dismiss

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

**Chat UI** (inside `HudScene`):
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

## Phase 7 Details — UI, Performance, and Release Prep

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

### Step 10.5 — PauseScene (`src/scenes/PauseScene.ts`)
- Additive overlay accessible from the HUD **Menu** button or ESC key at any time during play
- Semi-transparent dark backdrop; does not stop `GameScene` rendering
- **Content:**
  - **Resume** button — dismisses overlay, returns focus to game
  - **Settings** button — inline panel: master volume slider, SFX toggle, BGM toggle, keybinding reference table (read-only)
  - **Log Out** button — writes `players/{id}/online: false`, removes `/presence/{room}/players/{id}`, transitions to `LoginScene`
- ESC or **Resume** dismisses; cannot dismiss while `DeathScene` or `LevelUpScene` is active

### Step 10.6 — MapScene (`src/scenes/MapScene.ts`)
- Additive overlay triggered by the HUD **Map** button
- Full-screen Phaser sub-canvas (or DOM overlay) rendering a zoomed-out view of the 1000×1000 world
- **Content:**
  - Cells colour-coded by zone: plains = `#5a9`, forest = `#274`, desert = `#dc8`, river = `#37b`, dungeon entrance = `#421`
  - Fog-of-war: unvisited sectors rendered as solid `#111`; visited sectors reveal zone colours
  - POI icons overlay: known village = house icon, known dungeon entrance = cave icon
  - Player's current position = bright pin; player's house = star icon
  - Scrollable and zoomable (scroll-wheel / pinch) independently of the game camera
  - **Close** / ESC to dismiss
- Visited-sector tracking: stored in `localStorage` as a bitmask of 100 sectors (10×10 grid over the world); updated whenever the player enters a new sector

---

## Phase 8 Details — Publish to amen.pt

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

1. **Phase 1** — Project Scaffold & Firebase Setup
2. **Phase 2** — Sprite File Preparation
3. **Phase 3** — Playable World Exploration Slice
4. **Phase 4** — Playable Enemy Combat Slice
5. **Phase 5** — Playable NPC and Village Slice
6. **Phase 6** — Playable Progression Slice
7. **Phase 7** — UI, Performance, and Release Prep Slice
8. **Phase 8** — Publish

---

## Key Risk Areas

| Risk | Mitigation |
|---|---|
| Firebase write conflicts on shared cells | Use Firebase transactions for all cell mutations |
| World bootstrap race between clients | Use a transaction-backed generation lock in `config/world/status` |
| Pyodide load time (~5MB WASM) | Load in background; show loading screen |
| Script executor churn when players move | Debounce executor reassignment (500ms delay) |
| Map storage cost (up to 1M cells) | Generate once, write in chunks, and keep runtime reads viewport-scoped with local caching |
| Python sandbox escapes | Run Pyodide in a Web Worker with no DOM access |

---

## Extension Guide

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
// cave_bat_coward — flees player
{
  id: 'cave_bat_coward',
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

// cave_bat_aggressive — dives at player
{
  id: 'cave_bat_aggressive',
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

// cave_bat_special1 — swoops in groups (calls nearby bats)
{
  id: 'cave_bat_special1',
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
{ id: 'cave_bat_coward',     weight: 50 },
{ id: 'cave_bat_aggressive', weight: 30 },
{ id: 'cave_bat_special1',   weight: 20 },
```
5. No `SpawnManager` or `Combat` changes needed — the variant id flows through the whole system automatically

---

### How to add a new NPC profile

1. **Write the Python behaviour script** — scripts have access to the full Python API (`world`, `actions`, `memory`); copy the nearest existing NPC profile as a starting point
2. **Add an `NpcDefinition`** to `src/data/npcs.ts`:
```typescript
{
  id: 'villager_herbalist',
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
    { id: 'cave_bat_weak',          weight: 45 },
    { id: 'cave_bat_strong',        weight: 25 },
    { id: 'crystal_golem_weak',     weight: 20 },
    { id: 'crystal_golem_enraged',  weight: 10 },
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