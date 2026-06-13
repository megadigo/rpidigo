# RPG Game — Specification

## Overview

A browser-based multiplayer RPG with a persistent shared world, real-time Firebase synchronisation, and Python-scriptable entity behaviours. The world is generated **lazily in 32×32-tile chunks** as players explore — never upfront. When a player reaches an unvisited area, the visiting client generates the chunk deterministically from the world seed and writes it to Firebase; all later clients simply read the persisted tiles. There is no dedicated server — every client connects directly to the database and renders the world locally. All entities have a script that implements their behaviour.

---

## Sprite rendering convention

All sprite sheets are **16×16-pixel grids** of animation frames.

- **In Phaser** (tiles, entities, HUD): load each sheet with `frameWidth: 16, frameHeight: 16`.
- Tiles always render frame 0.
- Players, enemies, and NPCs use directional walk rows (5 frames per direction): `down`, `up`, `right`, `left`.
- Projectile sprites use 4 directional frames in a single row (left-to-right): `down`, `up`, `right`, `left`.
- While an entity is idle, render frame 0 of its current facing direction.
- **In DOM UI** (login character selection): use a `<canvas>` element and draw the source rect `(0, 0, 16, 16)` scaled to the desired display size (e.g. 32×32) with `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)`.

In login/portrait UI, always use frame 0. In-world animated entities use the full directional walk rows.

---

## World

### Size and structure
- The world is a fixed **1000×1000 tile grid** (coordinates 0–999 on each axis).
- The world is divided into named **zones** that determine terrain type, tiles, and enemy population.
- Tiles outside the grid boundary are impassable void.

### Lazy chunk generation
- The world is divided into **32×32-tile chunks** (chunk coordinates `(cx, cy)` where `cx = ⌊x/32⌋`, `cy = ⌊y/32⌋`). The full world fits in a 32×32 chunk grid.
- A random world seed is created once when the first player ever logs in, stored at `config/seed` in Firebase. All 100 village POIs and 100 dungeon-entrance POIs are computed from the seed at that time and stored at `config/pois`.
- A chunk is generated the first time any client explores its tiles. The client calls a pure deterministic function `generateChunk(cx, cy, seed, pois)` — same inputs always produce the same output — then batch-writes the 1024 tiles (plus enemies and NPCs if applicable) to Firebase and records a sentinel at `/map/chunks/{cx}_{cy}`.
- Any subsequent client entering the same area reads the persisted tiles from Firebase instead of regenerating.
- Once a tile is written it is never overwritten by world generation — player modifications (chopped trees, placed houses) persist permanently.
- Road paths between POIs are pre-computed from the seed in memory. When a chunk is generated, any road tiles that cross it are stamped on top of the noise-based terrain, guaranteeing that POIs will be connected by a passable road as the world is explored.

### Zones

| Zone | Description |
|---|---|
| **Plains** | Open grassland, sparse rocks and flowers. Default zone. |
| **Forest** | Dense woodland with oak, pine and dead trees, bushes, mushrooms. |
| **River** | Flowing water channels, sandy banks, reeds, mud, bridges at crossings. |
| **Desert** | Sand dunes, cacti, dry rocks, quicksand traps, oasis pools. |
| **Village** | Structured settlement with a 5×5 central square; 3-tile-wide cobblestone arms; tavern, barracks, chapel, workshop, and houses along each arm; market stall, well, quest board, wheat fields. |
| **Dungeon** | Underground multi-floor complex accessed via a surface entrance tile. |

- The 1000×1000 world is divided into a **10×10 grid of 100-tile sectors**. Each sector contains exactly one village and one dungeon entrance, placed at a seeded-random offset within the sector.
- Rivers are traced as connected paths within each chunk following the local elevation gradient.
- Road paths between all POIs are pre-computed from the seed. When a chunk containing a road segment is generated, single-tile `dirt_path` road tiles are stamped in, ensuring every explored POI is connected to every other explored POI by a walkable road.
- No global connectivity repair pass is needed; connectivity is guaranteed by the deterministic road network stamped at chunk-generation time.

### Sprite directory layout

All sprites live under `public/assets/sprites/`. The directories are:

| Directory | Contents |
|---|---|
| `World/Ground/` | Terrain tiles — grass, water, sand, paths, etc. (16×16) |
| `World/Nature/` | Natural world objects — trees, rocks, bushes, etc. (16×16) |
| `World/Buildings/` | Structures visible in the overworld — buildings, dungeon entrance, props (16×16) |
| `Player/` | Champion spritesheets (80×128) + login preview images |
| `Enemies/` | Enemy spritesheets (80×128) |
| `NPCs/` | NPC spritesheets (80×128) |
| `Items/` | Consumable items, materials, keys (16×16 icons) |
| `Projectiles/` | Projectile spritesheets (64×16, 4 directional frames: down/up/right/left) |
| `Weapons/` | Weapon icons (16×16) |
| `Armors/` | Armor icons (16×16) |
| `Tools/` | Tool icons (16×16) |
| `Dungeon/` | Dungeon **interior**: floor, walls, stairs, props (16×16) |
| `House/` | House **interior**: floor, door, furniture (16×16) |
| `Cellars/` | Cellar **interior**: floor, walls, stairs, props (16×16) |

Placeholder generation supports overwrite flags: `node scripts/gen-placeholders.cjs --overwrite-projectiles` refreshes only projectile sheets, while `--overwrite` refreshes all placeholders.

### Tiles by zone

All sprite paths are relative to `public/assets/sprites/`.

**Plains**

| Tile | Sprite |
|---|---|
| `grass` | `World/Ground/Grass.png` |
| `grass_tall` | `World/Ground/GrassTall.png` |
| `flower_yellow` | `World/Ground/GrassFlowerYellow.png` |
| `flower_red` | `World/Ground/GrassFlowerRed.png` |
| `dirt_path` | `World/Ground/PathDirt.png` |
| `rock_small` | `World/Nature/RockSmall.png` |
| `rock_large` | `World/Nature/RocksBig.png` |

**Forest**

| Tile | Sprite |
|---|---|
| `grass_dark` | `World/Ground/GrassDark.png` |
| `tree_oak` | `World/Nature/Trees.png` |
| `tree_pine` | `World/Nature/PineTrees.png` |
| `coconut_tree` | `World/Nature/CoconutTrees.png` |
| `bush` | `World/Nature/Bush.png` |
| `mushroom` | `World/Nature/Mushroom.png` |
| `log` | `World/Nature/Log.png` |
| `moss_rock` | `World/Nature/RockMoss.png` |
| `stump` | `World/Nature/Stump.png` |

**River**

| Tile | Sprite |
|---|---|
| `water_shallow` | `World/Ground/WaterShallow.png` |
| `water_deep` | `World/Ground/WaterDeep.png` |
| `sand_bank` | `World/Ground/SandBank.png` |
| `reeds` | `World/Nature/Reeds.png` |
| `mud` | `World/Ground/Mud.png` |

**Desert**

| Tile | Sprite |
|---|---|
| `sand` | `World/Ground/Sand.png` |
| `sand_dune` | `World/Ground/SandDune.png` |
| `dry_rock` | `World/Nature/DryRock.png` |
| `cactus` | `World/Nature/Cactus.png` |
| `dry_grass` | `World/Nature/Tumbleweed.png` |
| `oasis_water` | `World/Ground/WaterOasis.png` |
| `quicksand` | `World/Ground/Quicksand.png` |

**Village** — building sprites are in `World/Buildings/`; entering a building loads its interior room.

| Tile | Sprite | Notes |
|---|---|---|
| `cobblestone` | `World/Ground/Cobblestone.png` | Path / square |
| `house_hut` | `World/Buildings/Huts.png` | Small house — auto-enters on touch |
| `house_cabin` | `World/Buildings/Houses.png` | Medium house — auto-enters on touch |
| `barracks` | `World/Buildings/Barracks.png` | Guard barracks — auto-enters on touch |
| `chapel` | `World/Buildings/Chapels.png` | Chapel / temple — auto-enters on touch |
| `tavern` | `World/Buildings/Taverns.png` | Tavern — auto-enters on touch |
| `well` | `World/Buildings/Well.png` | Central landmark |
| `market_stall` | `World/Buildings/Market.png` | Merchant NPC spot |
| `workshop` | `World/Buildings/Workshops.png` | Blacksmith / crafting — auto-enters on touch |
| `quest_board` | `World/Buildings/QuestBoard.png` | Notice board *(also in `House/` for barracks interior)* |
| `street_sign` | `World/Buildings/StreetSign.png` | Path-end marker |
| `tombstone` | `World/Buildings/Tombstone.png` | Cemetery decoration — press `A` to spawn a skeleton horde |
| `garden_plot` | `World/Ground/GardenPlot.png` | Wheat field base |
| `wheat_field` | `World/Nature/Wheatfield.png` | Planted crop |

**House Interior** — room accessed from any enterable village building.

| Tile | Sprite | Notes |
|---|---|---|
| `house_floor` | `House/HouseFloor.png` | Interior floor |
| `dungeon_wall` | `Dungeon/DungeonWall.png` | Impassable border (shared with dungeon) |
| `workbench` | `House/WorkBench.png` | Crafting station (workshop) |
| `table` | `House/Table.png` | Furniture (tavern, workshop, residential) |
| `bed` | `House/Bed.png` | Furniture (residential) |
| `sofa` | `House/Sofa.png` | Furniture (tavern, chapel, residential) |
| `chest` | `House/Chest.png` | Storage / loot chest |
| `quest_board` | `World/Buildings/QuestBoard.png` | Barracks notice board *(copy in `House/` for custom art)* |
| `dungeon_altar` | `Dungeon/DungeonAltar.png` | Chapel altar *(shared with dungeon)* |
| `house_exit` | `House/Door.png` | Returns player to overworld |

**Dungeon entrance** — visible in the overworld.

| Tile | Sprite |
|---|---|
| `dungeon_entrance` | `World/Buildings/DungeonEntrance.png` |

**Dungeon interior** — underground rooms.

| Tile | Sprite |
|---|---|
| `dungeon_floor` | `Dungeon/DungeonFloor.png` |
| `dungeon_wall` | `Dungeon/DungeonWall.png` |
| `dungeon_stairs_down` | `Dungeon/StairDown.png` |
| `dungeon_stairs_up` | `Dungeon/StairUp.png` *(step on to exit)* |
| `dungeon_pillar` | `Dungeon/DungeonPillar.png` |
| `dungeon_chest` | `Dungeon/Chest.png` |
| `dungeon_altar` | `Dungeon/DungeonAltar.png` |
| `dungeon_tombstones` | `Dungeon/Tombstone.png` |

**Cellar** — small underground room attached to some houses (accessed via `dungeon_stairs_down` inside the house).

| Tile | Sprite |
|---|---|
| `cellar_floor` | `Cellars/CellarFloor.png` |
| `cellar_wall` | `Cellars/CellarWall.png` |
| `cellar_stairs_up` | `Cellars/CellarStairsUp.png` *(step on to return to house)* |
| `cellar_chest` | `Cellars/CellarChest.png` |

### Special tile interactions

Some overworld tiles trigger gameplay events when the player presses `A` while adjacent.

| Tile | Interaction |
|---|---|
| `tombstone` | Spawns a wave of `skeleton_weak` enemies at tiles surrounding the tombstone; enemies are written to Firebase presence and immediately engage the player. |

After removing tile IDs from generation/data (for example trap tiles), reset Firebase map data before testing so rooms/chunks regenerate with the current schema.

**Special**

| Tile | Sprite |
|---|---|
| `void` | `World/Ground/Void.png` *(impassable world-boundary barrier)* |

Some tiles reduce movement speed (`grass_tall`, `mud`, `quicksand`, `sand_dune`, `wheat_field`) rather than blocking it.

---

## House Interior Maps

Every enterable village building (house_hut, house_cabin, barracks, chapel, tavern, workshop) has a corresponding **interior room** stored in Firebase under `map/house_{tx:04d}_{ty:04d}` where `(tx, ty)` is the building's overworld tile position.

### Structure
- Room size: **8×8 tiles**
- `dungeon_wall` borders the room perimeter (impassable)
- `house_floor` fills the interior
- `house_exit` tile at centre-bottom (col 4, row 7) returns the player to the overworld
- Some residential houses (`house_hut`, `house_cabin`) also include `dungeon_stairs_down`, which enters a small cellar room
- Furniture is **seeded-random per building**, themed by type:
  - **house_hut / house_cabin**: bed, optional table or sofa, chest with gold
  - **tavern**: 2–4 tables, 1–2 sofas, chest with gold
  - **workshop**: 2–3 workbenches, chest, optional table
  - **barracks**: quest_board (near top), 2–3 chests, optional table
  - **chapel**: dungeon_altar (near top-centre), 1–2 chests, optional sofa

### Room ID derivation
The room ID `house_${tx.padStart(4,'0')}_${ty.padStart(4,'0')}` is derived deterministically from the building's world coordinates — no metadata storage is needed. Dungeon rooms use `dungeon_${tx:04d}_${ty:04d}_floor_{n}`. House cellars use `cellar_${tx:04d}_${ty:04d}`.

### Entering and exiting
- Walk up to a building tile (touch it) → camera automatically transitions to the interior room
- Step onto `dungeon_stairs_down` inside a qualifying house → transitions to `cellar_${tx}_${ty}`
- Step onto `cellar_stairs_up` inside a cellar → returns to the source house interior
- Step onto the `house_exit` tile → automatically returns the player to the overworld at the original entry position
- Step onto `dungeon_stairs_up` inside a dungeon floor > 1 → ascends to floor N−1; floor 1 exits to overworld
- An 800 ms cooldown prevents immediate re-triggering after each transition

---

## Players

### Registration and login
- On first visit the player enters a **name, email and password**. The account is created and never deleted, even when the player is offline.
- On subsequent visits the player logs in with the same name and password to resume with the same character.
- Passwords are stored as SHA-256 hashes.
- An email is sent with the name and password of the player.

### Attributes
- **Level** — increases by gaining XP from killing enemies and collecting treasure.
- **HP / Max HP** — health points. Player respawns at their house when HP reaches zero.
- **MP / Max MP** — mana points consumed by magic weapons.
- **Stats** — Strength (`STR`), Dexterity (`DEX`), Intelligence (`INT`), Vitality (`VIT`). Points are awarded on level-up and can be allocated by the player.
- **Power** — effective attack value depends on attack family:
  - melee power = `equipped_weapon_power + STR × 2.0`
  - ranged power = `equipped_weapon_power + DEX × 1.8`
  - magic power = `equipped_weapon_power + INT × 2.2`
- **Defense** — incoming damage reduction: `VIT × 0.8 + total equipped armor defense`. Minimum 1 damage always applies regardless of defense total.
- **Critical chance** — `baseCrit + DEX × 0.25%`, capped at 35%.
- **Inventory** — a list of collected items and quantities.
- **Equipped weapon** — one weapon slot; determines power and attack type.
- **Equipped armor** — five independent slots: `helmet`, `chestplate`, `leggings`, `boots`, `gloves`. Each piece adds `defense` and may carry a special effect (speed boost, lifesteal, or flat power bonus).
- **Gold** — currency stored as a dedicated counter separate from inventory. Gained from enemy drops, treasure chests, and selling items. Used to purchase items at village shops.
- **Quest progression counters** — persistent lifetime counters used by quest objectives, at minimum:
  - `killsByEnemyId` (map enemy template -> kill count),
  - `villagesVisited`,
  - `dungeonsVisited`,
  - `goldCollectedTotal`,
  - `craftActionsCompleted`.
  Recommended additional counters for richer quests:
  - `craftedByItemId`, `collectedByItemId`,
  - `dungeonFloorsEntered`, `dungeonFloorsCleared`,
  - `questsAccepted`, `questsCompleted`, `questsFailed`,
  - `distanceTravelledTiles`, `deaths`.

### Spawn and house
- On first login the player is placed at a **random reachable passable position** within the world grid (with a 50-tile margin from world edges).
- A **house tile** is automatically placed within 5 tiles of the spawn point on a grass cell. The player does not choose or build the house — it is always there from the start.
- The house position is fixed for the life of the character.
- Entering the house tile transitions into a small **interior room** containing a `workbench`, a personal storage chest, and a `vendor_stall` (see [Player Vendors and Trading](#player-vendors-and-trading)).
- The house is also the **respawn point** after death.

### Death and respawn
- On death the player drops all inventory items at their current position as loot. Gold is **not** dropped — it is stored separately and survives death.
- The player respawns at their house with 50% HP. The character and its data are never deleted.
- If items were dropped, the player's record stores `lastDeathLoot` (room + tile of the loot chest). A system chat message gives the compass direction and tile distance, and a gold compass-arrow icon is shown at the edge of the screen pointing toward the chest whenever the player is in the same room as it. The hint clears automatically when the player opens that chest or walks within 2 tiles of it.

### PVP
- Players can attack other players only when **both are level 10 or above**.

### Sprites

Players choose one of eight available champion sprites at character creation. All champion sprite files are in `public/assets/sprites/Player/`. The login selection grid draws **frame 0** (the top-left 16×16 cell) of each champion's own spritesheet onto a `<canvas>`, scaled to 32×32 — there are no separate `player_*.png` preview files. In-game, the player uses directional 5-frame walk rows from the same sheet and faces the active movement direction — see the global [Sprite rendering convention](#sprite-rendering-convention).

| Champion | Spritesheet |
|---|---|
| Arthax | `Player/Arthax.png` |
| Börg | `Player/Börg.png` |
| Gangblanc | `Player/Gangblanc.png` |
| Grum | `Player/Grum.png` |
| Kanji | `Player/Kanji.png` |
| Katan | `Player/Katan.png` |
| Okomo | `Player/Okomo.png` |
| Zhinja | `Player/Zhinja.png` |

---

## Gold and Currency

Gold is the world's only currency, held as a dedicated integer on the player (not an inventory item). It persists through death.

### Sources

| Source | Gold gained |
|---|---|
| Enemy drop | Auto-collected when the player walks over loot; amount from enemy's loot table |
| Treasure chest (`chest`) | 10–50 gold, seeded at world generation |
| Dungeon chest floor 1 | 20–80 gold |
| Dungeon chest floor 2+ | 40–150 gold |
| Boss room loot | 200–400 gold |
| Selling items at shop | 50% of the item's buy price |

### Gold-stealing enemies

Some enemies steal gold directly from the player on a successful hit, storing it as `carriedGold`. If killed, `carriedGold` is returned as a loot pickup. If the enemy **flees and escapes beyond 30 tiles**, the stolen gold is lost permanently.

| Enemy | Steals per hit | Notes |
|---|---|---|
| `thief_weak` | 3–12 gold | Steals on first hit, then immediately switches to fleeing; fast — kill it before it escapes |
| `bandit_strong` | 5–20 gold | Steals on each hit while fighting; drops stolen gold on death |
| `desert_bandit_strong` | 8–25 gold | Steals on each hit; drops stolen gold on death |
| `goblin_scout_strong` | 6–18 gold | Steals on repeated hits while fighting; drops stolen gold on death |

- A player can never be reduced below 0 gold — the enemy takes `min(stealAmount, player.gold)`.
- The chat panel shows a system notification when gold is stolen: *"Thief stole 12 gold from you!"*

---

## Player Vendors and Trading

Every player house includes a **vendor stall** (`vendor_stall` tile, placed alongside the workbench and storage chest) that lets the owner sell items from their personal storage chest to other players — including while the owner is offline.

### Data model
- `players/{id}/vendor: { listings: Record<string, VendorListing>, till: number }`
  - `VendorListing = { itemId: string; quantity: number; price: number }`, keyed by a generated listing id.
  - `till` accumulates gold from sales, collected by the owner separately from their main `gold` balance (keeps offline sales auditable and prevents a buyer transaction from writing directly to the owner's spendable gold).

### Owner flow (`VendorScene`, opened with `E` on `vendor_stall` by the house owner)
- Pick an item + quantity from the personal storage chest and set an asking price (per unit) to create or update a listing.
- Remove a listing — unsold quantity returns to the storage chest.
- Collect `till` — moves accumulated gold into `players/{id}/gold`.

### Buyer flow (visiting another player's house and using their `vendor_stall`)
- Shows the owner's active listings (item, quantity remaining, price).
- Buying runs a Firebase transaction on `players/{ownerId}/vendor/listings/{listingId}` that decrements `quantity` (removing the listing at 0) — this prevents two buyers from overselling the same stock.
- On success: buyer's gold decreases by `price × qty`, buyer's inventory gains the item, and `players/{ownerId}/vendor/till` increases by `price × qty`.
- Buying is blocked if the buyer is the owner, or if the listing no longer has enough quantity.

### Placement
- `vendor_stall` is placed in `player_house` interiors near the workbench/chest, generated the same deterministic-seeded way as other house furniture (`HouseGen.ts`).

---

## NPCs

NPCs use the same `{baseType}_{profile}` system as enemies. Each profile has its own Python behaviour script. Conversations are triggered when a player walks adjacent to the NPC.

### Built-in NPC profiles

All sprite paths are relative to `public/assets/sprites/`.

| Profile | Behaviour | Sprite |
|---|---|---|
| `villager_wanderer` | Roams the village in a small radius around a home position; greets players with random lines | `Characters/Workers/FarmerTemplate.png` |
| `villager_hunter` | Patrols the forest edge near the village; shares warnings about nearby enemies | `Characters/Soldiers/Ranged/BowmanTemplate.png` |
| `villager_fisherman` | Stays near river or water tiles; shares river and water-zone knowledge | `Characters/Workers/FarmerTemplate.png` |
| `villager_gossiper` | Stands near the village well; shares world knowledge — dungeon locations, treasure hints, boss sightings, directions to other villages | `Characters/Workers/FarmerTemplate.png` |
| `healer_standard` | Restores the player's HP and MP to full when the player walks adjacent; no cost | `Characters/Soldiers/Ranged/MageTemplate.png` |
| `merchant_standard` | Runs the village shop; opens a buy/sell UI when the player interacts; stocks armors, Tier 1–2 weapons, and common materials; prices vary by village zone and per-village seed | `Characters/Workers/FarmerTemplate.png` |
| `guard_patrol` | Patrols the village entry path; warns players about dangers outside | `Characters/Soldiers/Melee/SwordsmanTemplate.png` |
| `dog` | Spawns near residential buildings in villages (50% chance per house); follows the player for 5 minutes after being interacted with via `A`; loses interest and returns to its home position after the timer expires without re-interaction | `Animals/Dog.png` |

### Gossiper knowledge

The gossiper NPC reads from `config/pois` to generate contextual tips:
- **Dungeon locations** — gives approximate coordinates of the nearest unvisited dungeons
- **Village directions** — gives compass direction and rough distance to other villages
- **Boss sightings** — warns about powerful enemies spotted nearby
- **Treasure hints** — generic hints about loot-dense areas (desert chests, dungeon altars)

### Healer

The healer uses `actions.heal(playerId, hp, mp)` in its Python script to write the player's HP and MP back to their Firebase entry, clamped to `maxHp`/`maxMp`. No gold cost is required (can be added as a future extension).

### New NPC profiles

Adding a new NPC profile requires only a new `NpcDefinition` with a Python script — no engine changes. Any behaviour achievable in Python (trade, quest-giving, mini-game, escort) can be expressed as a new profile.

---

## Quests

Quests are structured objective chains offered by three source types:
- **Quest boards** (`quest_board` tile interactions in villages/barracks)
- **Tavern quest-givers** (innkeeper or tavern villagers)
- **Any villager profile** (`villager_*`) marked as a quest giver

### Quest categories

| Category | Examples |
|---|---|
| Kill | Kill `wolf_weak` × 10; kill any bandit × 8 |
| Delivery | Bring item to another village NPC/board |
| Exploration | Visit a new village; enter dungeon floor 2 |
| Crafting | Craft `wooden_sword` × 2; craft any potion × 5 |
| Collection | Gather wood/ore/leather counts |
| Hybrid | Kill + collect + deliver in one quest |

### Objective model

- A quest contains one or more objective groups.
- Groups support **AND** / **OR** composition.
- Each objective references one or more progression counters and a target value.
- Optional constraints:
  - required zone / village / dungeon,
  - item or enemy tag filters,
  - expiration time (daily/weekly/event),
  - minimum player level.

### Progress counters (quest runtime source of truth)

All quest progress is computed from persistent player counters rather than ad-hoc per-quest custom logic.

Minimum counters required by design:
- `killsByEnemyId.{enemyTemplateId}`
- `villagesVisited`
- `dungeonsVisited`
- `goldCollectedTotal`
- `craftActionsCompleted`

Recommended counters to support future quest variety:
- `craftedByItemId.{itemId}`
- `collectedByItemId.{itemId}`
- `dungeonFloorsEntered`
- `dungeonFloorsCleared`
- `distanceTravelledTiles`
- `deaths`

### Firebase layout (design)

- `players/{id}/progressCounters/*` — canonical counter state per player
- `quests/templates/{questId}` — static quest definitions and objective schema
- `quests/boards/{villageId}` — rotating board offers for each village
- `players/{id}/quests/{active|completed|failed}` — per-player quest state and history

### Rewards

Quest rewards may grant one or more of:
- XP
- gold
- items/materials
- reputation/favor (future system)
- unlock tokens (for recipes/dialog branches)

### Acceptance and completion flow

1. Player interacts with board/tavern/villager quest giver.
2. Offer list filtered by level, prerequisites, and repeatability window.
3. On accept, quest instance is created under `players/{id}/quests/active`.
4. Progress updates passively from counters and objective evaluator.
5. When complete, player claims reward from giver or quest log.

### Anti-abuse rules (design)

- Repeatable quests have cooldown windows (`daily`, `weekly`, or custom seconds).
- Delivery quests verify destination village/NPC before completion.
- Server-trust model remains Firebase-client based, so objective evaluation should be deterministic and auditable from counters.

---

## Enemies

Each enemy has HP, MP, Power and a **state machine**: `idle`, `patrol`, `chase`, `attack`, `flee`, `dead`.

### Behaviour profiles

Every enemy type supports **named behaviour profiles** identified by `{baseType}_{profile}`. The profile label is a free-form string — `aggressive`, `coward`, `typeA`, `special1`, `berserker`, `healer`, or anything descriptive. There is no required naming convention.

Each profile is a fully independent template with its own stats and its own Python behaviour script. Profiles of the same base type share a display name and sprite, so two enemies that look identical to the player can behave completely differently:

| Profile ID | Behaviour |
|---|---|
| `wolf_coward` | Flees any player on sight |
| `wolf_aggressive` | Chases and attacks; only flees at HP < 15% |
| `slime_typeA` | Moves away from the player; never attacks |
| `slime_corrosive` | Chases and attacks; corrodes the player's armour on hit |
| `goblin_special1` | Patrols and calls nearby goblins when it spots a player |
| `necromancer_standard` | Keeps distance; ranged spell attack |
| `necromancer_summoner` | Keeps distance; re-spawns nearby dead skeletons every 10 s |

A base type can have one profile or many. The zone spawn table lists which profile IDs appear in that zone and at what relative weight — for example 50% `wolf_coward`, 30% `wolf_aggressive`, 20% `wolf_berserker` in the Forest zone.

### Enemy types by zone

Enemies are zone-specific — they spawn only in their adapted zones:

All sprite paths are relative to `public/assets/sprites/`.

| Base type | Zone | Variants | Sprite |
|---|---|---|---|
| `wolf` | Plains, Forest | `_weak`, `_strong` | `Animals/Boar.png` |
| `bandit` | Plains | `_weak`, `_strong` *(strong variant steals gold)* | `Characters/Soldiers/Melee/AssasinTemplate.png` — `_strong` uses `AxemanTemplate.png` |
| `giant_spider` | Forest | `_weak`, `_venomous` | `Characters/Monsters/GiantAnimals/GiantCrab.png` |
| `goblin_scout` | Forest | `_weak`, `_strong` | `Characters/Monsters/Orcs/ArcherGoblin.png` — `_strong` uses `SpearGoblin.png` |
| `treant` | Forest | `_strong` | `Characters/Monsters/Orcs/Minotaur.png` |
| `river_troll` | River | `_weak`, `_strong` | `Characters/Monsters/Orcs/Orc.png` |
| `crocodile` | River | `_weak` | `Animals/MarineAnimals.png` |
| `water_spirit` | River | `_weak`, `_enraged` | `Characters/Monsters/Demons/PurpleDemon.png` |
| `scorpion` | Desert | `_weak`, `_giant` | `Characters/Monsters/GiantAnimals/GiantCrab.png` |
| `sand_worm` | Desert | `_weak` | `Characters/Monsters/Orcs/ClubGoblin.png` |
| `mummy` | Desert | `_weak` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `desert_bandit` | Desert | `_strong` *(steals gold on hit)* | `Characters/Soldiers/Melee/AssasinTemplate.png` |
| `thief` | Village outskirts | `_weak` *(steals gold on hit)* | `Characters/Soldiers/Melee/AssasinTemplate.png` |
| `dark_mage` | Village outskirts | `_weak`, `_strong` | `Characters/Soldiers/Ranged/MageTemplate.png` — `_strong` uses `Characters/Monsters/Orcs/OrcMage.png` |
| `skeleton` | Dungeon floor 1 | `_weak` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `slime` | Dungeon floor 1 | `_weak`, `_corrosive` | `Characters/Monsters/Slimes/Slime.png` — `_corrosive` uses `SlimeBlue.png` |
| `zombie` | Dungeon floor 1 | `_weak`, `_armoured` | `Characters/Monsters/Undead/Skeleton-Soldier.png` |
| `dark_knight` | Dungeon floor 2+ | `_weak`, `_elite` | `Characters/Soldiers/Melee/SwordsmanTemplate.png` — `_elite` uses `Characters/Soldiers/Mounted/RedKnight.png` |
| `ghost` | Dungeon floor 2+ | `_weak`, `_enraged` — passes through walls; immune to physical weapons | `Characters/Monsters/Demons/PurpleDemon.png` |
| `necromancer` | Dungeon floor 2+ | `_weak`, `_strong` | `Characters/Monsters/Undead/Necromancer.png` |
| `dungeon_boss` | Dungeon boss room | `_strong` — one per dungeon; locks room on aggro; guaranteed rare loot | `Characters/Monsters/Dragons/BlackDragon.png` |

- Each profile has a **Python behaviour script** stored in its template and copied into the entity instance at spawn. The script is the sole definition of how that profile moves, attacks, and reacts.
- Enemies respawn at their original cell after a configurable timer.
- On death enemies drop loot according to their variant's loot table.

---

## Chat

### Proximity chat
- Players can type messages that are **visible only to nearby players** (within 15 tiles in the overworld, or all players in the same dungeon room or house interior).
- Messages are written to Firebase under the current room key and include the sender's position, name, and timestamp.
- Clients filter received messages by distance — messages from far-away players are silently ignored.
- Messages older than 5 minutes are automatically pruned.

### NPC speech
- NPC `actions.speak(text)` calls appear in the same chat panel with the NPC's name in a distinct colour, so player and NPC speech share the same interface.

### System notifications
- Level-up, item found, player death, player entering/leaving range, and other game events appear as system messages in the chat panel.

---

## Audio and ambience music

Music tracks are loaded from `public/assets/music/` and selected by context-aware runtime rules.

### Playlists

| Playlist ID | File naming convention | Usage |
|---|---|---|
| `world_ambient` | `ambient_*` | Overworld exploration when local threat is low |
| `world_action` | `action_*` | Overworld combat pressure with many nearby enemies |
| `dungeon_dark_ambient` | `dark_ambient_*` | Any dungeon floor, always |

### Selection rules

- Overworld (`room = 0`):
  - Compute threat score every 1 second using enemies within 12 tiles.
  - Score contribution per enemy: normal = 1, elite/boss = 2, +1 extra if enemy state is `chase`/`attack` against the local player.
  - If score >= 6, play `world_action`; otherwise play `world_ambient`.
- Dungeon rooms (`roomId` starts with `dungeon_`): always play `dungeon_dark_ambient` regardless of enemy count.

### Randomization and soft changes

- Track choice uses a shuffle bag per playlist; a track cannot repeat until all tracks in that playlist have been played.
- Playlist changes must be soft:
  - fade out current track over 2.5 s,
  - start the new track at volume 0 and fade in over 2.5 s,
  - enforce a minimum dwell time of 15 s before allowing another switch.
- On scene reload/reconnect, continue the current playlist mood when possible instead of hard-restarting the same song.

### Player controls

- A ♪ button in the HUD top-right toolbar opens a settings panel:
  - music enabled toggle (ON / OFF),
  - music volume slider (0–100).
- Audio preferences persist locally (`localStorage`) and apply immediately.

---

## Distributed script execution

- There is no server. **The nearest online player client executes scripts** for offline players, NPCs, and enemies within a configurable maximum distance.
- If no player is online within range, entities do not act.
- Execution ownership must always prefer the nearest eligible player client. If a different player becomes nearer, ownership may move to that nearer client to balance.
- Owned entities are refreshed in **oldest-update-first order** so the entities that have waited longest get processed first.
- Each frame the scheduler runs scripts only until a **wall-clock time budget** (`BUDGET_MS`, 6 ms) is exhausted; any remaining overdue entities are deferred to the next frame. There is no fixed per-frame entity count — the budget self-limits work to avoid frame drops.
- Only entities within a Chebyshev radius (`VICINITY_RADIUS`, 20 tiles) of the local player are considered. Each entity also has a per-tick interval derived from its `speed` (slow 1000 ms / normal 500 ms / fast 250 ms; NPCs 1000 ms), so a fast enemy is refreshed more often than a slow one.
- A client claims execution ownership by writing its player ID to the entity record. A claim is considered **stale** once the entity's `lastLogicAt` has not advanced for `CLAIM_TTL_MS` (10 s) — at which point any other in-vicinity client may reclaim it. Ownership is also released when the scene shuts down.
- Scheduler rule: collect all in-vicinity entities whose tick interval has elapsed, sort by `lastLogicAt` ascending, and execute from oldest until the time budget runs out.
- Scripts run in a sandboxed Python environment (Pyodide WASM) with access to entity state, nearby world data, and a set of actions (`move`, `attack`, `speak`, `setState`). No file or network access is permitted.

---

## World persistence

Game state is split across purpose-built Firebase Realtime Database collections. Each collection has a single responsibility and its own security scope.

| Collection | Responsibility | Write frequency |
|---|---|---|
| `/config` | World seed, POI layout, world generation status, content extension registry | Written once at bootstrap; read at startup |
| `/map/{room}/{x}_{y}` | Tile data — type, variant, metadata | Written once during full world generation; rarely modified |
| `/players/{id}` | Full canonical player state including position | Written on every player action |
| `/entities/npcs/{id}` | Full NPC state including position | Written on every script tick |
| `/entities/enemies/{id}` | Full enemy state including position | Written on every script tick |
| `/presence/{room}` | Lightweight render snapshot (x, y, sprite, state) for all entities in a room | Written on every move; Phaser subscribes here |
| `/chat/{room}` | Proximity chat messages | Append-only; pruned after 5 minutes |
| `/shops/{villageId}` | Per-village limited stock counters and restock timestamp | Written on each purchase of a limited item |
| `/players/{id}/progressCounters/*` | Quest progression counters (kills, visits, gold collected, crafts, etc.) | Written on relevant gameplay events |
| `/quests/templates/{questId}` | Static quest definitions | Rare writes; mostly read-only |
| `/quests/boards/{villageId}` | Village-specific quest board offers | Rotating writes (time/event based) |
| `/players/{id}/quests/{active|completed|failed}` | Per-player quest state and history | Written on accept/progress/claim/fail |

**Separation of canonical state from render state:** `/players/{id}` and `/entities/` hold full data. `/presence/{room}` holds only what the renderer needs (position, sprite, HP bar value, state label). A player move writes only the coordinates to both paths — no full-document copy or delete is needed.

**Entity movement:** Position is a field on the entity's own document (`/players/{id}/x`, `/players/{id}/y`, `/players/{id}/room`). On move, only those three fields are updated (plus the matching entry in `/presence/{room}`). If the room changes, the old presence entry is removed and a new one is written. No full-document remove-and-rewrite occurs.

**Tile persistence:** Once a cell is written to `/map` it is never overwritten by generation — player modifications (chopped trees, placed houses) persist permanently.

**Extensibility:** New content types (mounts, guilds, quests) get their own top-level collection without touching existing paths. Runtime content additions go under `/config/extensions/` and are merged into registries at startup.

---

## Resources and gathering

Players can gather raw materials from the world by interacting with specific tiles. All sprite paths are relative to `public/assets/sprites/`.

| Action | Tile | Material obtained | Material sprite |
|---|---|---|---|
| Chop | `tree_oak`, `tree_pine` | `wood` | `User Interface/UiIcons.png` *(wood frame)* |
| Cut | `bush`, `reeds` | `fiber` | `User Interface/UiIcons.png` *(fiber frame)* |
| Cut | `cactus` | `fiber` | `User Interface/UiIcons.png` *(fiber frame)* |
| Mine | `rock_large`, `moss_rock`, `dry_rock` | `stone` | `User Interface/UiIcons.png` *(stone frame)* |
| Mine | `rock_large` (rare) | `iron_ore` | `User Interface/UiIcons.png` *(iron ore frame)* |
| Mine | `dry_rock` (rare) | `iron_ore` | `User Interface/UiIcons.png` *(iron ore frame)* |
| Pick | `mushroom` | `mushroom` | `User Interface/UiIcons.png` *(mushroom frame)* |
| Pick | `flower_yellow`, `flower_red` | `flower` | `User Interface/UiIcons.png` *(flower frame)* |

Enemy drops also provide materials — all use frames from `User Interface/UiIcons.png`:

| Material | Sprite frame |
|---|---|
| `hide` | hide frame |
| `bone` | bone frame |
| `chitin` | chitin frame |
| `silk` | silk frame |
| `crystal` | crystal frame |
| `ancient_wood` | ancient wood frame |
| `mana_crystal` | mana crystal frame |
| `ectoplasm` | ectoplasm frame |
| `dark_crystal` | dark crystal frame |
| `slime_gel` | slime gel frame |
| `poison_sac` | poison sac frame |
| `meat` | meat frame |
| `sand_crystal` | sand crystal frame |
| `boss_key` | `User Interface/Icons-Essentials.png` *(key frame)* |

After gathering, the source tile changes to a depleted form and regenerates automatically after a timer.

---

## Crafting and weapons

### Crafting stations

| Station | Location | Purpose |
|---|---|---|
| `workbench` | Inside player house | Basic weapons and tools from natural materials |
| `workshop` | Village | Metal weapons; smelting `iron_ore` into `iron_ingot` |
| `dungeon_altar` | Dungeon boss room | Rare and magic weapons from dungeon materials |

### Intermediate processing

Some recipes require processed materials. Output sprites are frames from `User Interface/UiIcons.png` unless noted.

| Process | Input | Output | Station | Output sprite |
|---|---|---|---|---|
| Smelt | `iron_ore` ×3 | `iron_ingot` ×1 | `workshop` | iron ingot frame |
| Tan | `hide` ×2 + `fiber` ×1 | `leather` ×1 | `workbench` | leather frame |
| Brew | `poison_sac` ×1 + `mushroom` ×1 | `poison_vial` ×2 | `workbench` | `User Interface/Icons-Essentials.png` *(vial frame)* |
| Refine | `sand_crystal` ×2 + `stone` ×1 | `refined_crystal` ×1 | `workshop` | refined crystal frame |

### Weapons

Most weapons are crafted at stations using gathered materials. Tier 1 and Tier 2 weapons are also stocked in village shops for players who prefer to buy rather than craft. Armor can be crafted or purchased.

All weapon sprites are relative to `public/assets/sprites/Objects/`.

**Tier 1 — Workbench · Level 1** *(Forest & Plains materials)*

| Weapon | Power | Type | Recipe | Sprite |
|---|---|---|---|---|
| `wooden_sword` | 8 | melee | `wood` ×5 + `fiber` ×2 | `SwordShort.png` |
| `stone_mace` | 11 | melee | `stone` ×4 + `wood` ×2 | `ShortBig.png` |
| `bone_dagger` | 9 | melee | `bone` ×3 + `fiber` ×1 | `SwordShort.png` *(dagger frame)* |
| `hunting_bow` | 10 | ranged | `wood` ×4 + `fiber` ×3 + `hide` ×2 | `ArrowShort.png` |
| `wooden_staff` | 7 | magic | `wood` ×3 + `mushroom` ×2 | `FireballProjectile.png` *(staff frame)* |
| `stone_pick` | 6 | tool | `stone` ×3 + `wood` ×2 | `ShortBig.png` *(pick frame)* |
| `stone_axe` | 8 | tool | `stone` ×3 + `wood` ×2 | `Axe.png` |

**Tier 2 — Workbench · Level 4** *(Desert & River materials)*

| Weapon | Power | Type | Special | Recipe | Sprite |
|---|---|---|---|---|---|
| `chitin_blade` | 15 | melee | — | `chitin` ×4 + `stone` ×2 | `SwordShort.png` |
| `silk_whip` | 13 | melee | hits 2 tiles | `silk` ×3 + `wood` ×2 | `ArrowShort.png` *(whip frame)* |
| `poison_dagger` | 11 | melee | poison on hit | `wood` ×3 + `poison_sac` ×2 | `SwordShort.png` *(dagger frame)* |
| `vine_staff` | 12 | magic | slows target | `ancient_wood` ×2 + `mushroom` ×3 | `FireballProjectile.png` *(staff frame)* |
| `crystal_wand` | 14 | magic | — | `crystal` ×2 + `wood` ×2 | `FireballProjectile.png` *(wand frame)* |
| `bone_bow` | 13 | ranged | — | `bone` ×3 + `fiber` ×3 + `wood` ×2 | `ArrowLong.png` |
| `leather_sling` | 10 | ranged | area (3 tiles) | `leather` ×2 + `fiber` ×2 | `ArrowShort.png` *(sling frame)* |

**Tier 3 — Blacksmith Forge · Level 8** *(Metal — requires `iron_ingot`)*

| Weapon | Power | Type | Special | Recipe | Sprite |
|---|---|---|---|---|---|
| `iron_sword` | 20 | melee | — | `iron_ingot` ×4 | `SwordShort.png` |
| `iron_axe` | 22 | melee | instant chop | `iron_ingot` ×3 + `wood` ×1 | `Axe.png` |
| `iron_spear` | 18 | melee | range 2 tiles | `iron_ingot` ×2 + `wood` ×3 | `Spear.png` |
| `iron_bow` | 19 | ranged | — | `iron_ingot` ×2 + `fiber` ×4 | `ArrowLong.png` |
| `iron_staff` | 20 | magic | — | `iron_ingot` ×2 + `mana_crystal` ×1 | `FireballProjectile.png` *(staff frame)* |
| `sand_lance` | 25 | melee | — | `chitin` ×3 + `refined_crystal` ×2 | `Spear.png` *(lance frame)* |

**Tier 4 — Dungeon Altar · Level 12** *(Rare — dungeon-only materials)*

| Weapon | Power | Type | Special | Recipe | Sprite |
|---|---|---|---|---|---|
| `shadow_blade` | 28 | melee | lifesteal 10% | `iron_ingot` ×4 + `ectoplasm` ×2 | `SwordShort.png` *(shadow frame)* |
| `soul_staff` | 26 | magic | AOE burst | `ancient_wood` ×2 + `mana_crystal` ×3 + `ectoplasm` ×1 | `FireballProjectile.png` |
| `dark_bow` | 30 | ranged | pierces enemies | `iron_ingot` ×2 + `dark_crystal` ×1 + `fiber` ×3 | `ArrowLong.png` *(dark frame)* |
| `slime_launcher` | 16 | ranged | area + slows | `slime_gel` ×5 + `wood` ×3 | `BallistaBolt.png` |
| `necro_staff` | 28 | magic | summons skeleton | `bone` ×5 + `mana_crystal` ×2 + `ectoplasm` ×3 | `FireballProjectile.png` *(necro frame)* |
| `boss_blade` | 35 | melee | — | `boss_key` ×1 + `iron_ingot` ×6 + `dark_crystal` ×2 | `SwordShort.png` *(boss frame)* |

### Ranged projectiles and elemental magic

- `ranged` and `magic` weapons spawn physical projectile entities with deterministic IDs for multiplayer sync.
- Projectile sprite frame mapping follows movement direction: `down=0`, `up=1`, `right=2`, `left=3`.
- Projectile core stats: `projectileSpeed`, `projectileRange`, `projectileRadius`, `lifetimeMs`, `cooldownMs`.
- Bows are cooldown-based and do not require ammo items.

Elemental magic schools:

| Element | Base effect | Secondary effect |
|---|---|---|
| `fire` | direct magic damage | burn DOT for 3 s |
| `water` | direct magic damage | slow (-25% move speed) for 2 s |
| `earth` | direct magic damage | armor break / stagger |
| `air` | direct magic damage | fast projectile with light knockback or short chain |

- Every magic cast consumes MP; cast is blocked when MP is insufficient.
- HUD must show a clear "not enough MP" message when a cast fails.
- Status effects from elements are applied through a shared combat-status pipeline (player and enemies use the same effect model).

### Armors

Armor is crafted at stations or bought in village shops. Each piece occupies one of five slots and adds `defense` to the player's damage-reduction total. All armor sprites use frames from `public/assets/sprites/User Interface/Icons-Essentials.png`.

**Tier 1 — Workbench · Level 1** *(Leather — hide & fiber)*

| Armor | Slot | Defense | Recipe | Sprite frame |
|---|---|---|---|---|
| `leather_helmet` | helmet | 2 | `hide` ×1 + `fiber` ×2 | leather helmet |
| `leather_chestplate` | chestplate | 4 | `leather` ×3 + `fiber` ×2 | leather chestplate |
| `leather_leggings` | leggings | 3 | `leather` ×2 + `fiber` ×2 | leather leggings |
| `leather_boots` | boots | 2 | `leather` ×1 + `fiber` ×2 | leather boots |
| `leather_gloves` | gloves | 1 | `hide` ×1 + `fiber` ×1 | leather gloves |

**Tier 2 — Workbench · Level 4** *(Chitin — desert & river materials)*

| Armor | Slot | Defense | Special | Recipe | Sprite frame |
|---|---|---|---|---|---|
| `chitin_helmet` | helmet | 5 | — | `chitin` ×2 + `leather` ×1 | chitin helmet |
| `chitin_chestplate` | chestplate | 9 | — | `chitin` ×4 + `leather` ×2 | chitin chestplate |
| `chitin_leggings` | leggings | 7 | — | `chitin` ×3 + `leather` ×1 | chitin leggings |
| `chitin_boots` | boots | 4 | — | `chitin` ×2 | chitin boots |
| `chitin_gloves` | gloves | 3 | — | `chitin` ×1 + `fiber` ×1 | chitin gloves |

**Tier 3 — Blacksmith Forge · Level 8** *(Iron — requires `iron_ingot`)*

| Armor | Slot | Defense | Special | Recipe | Sprite frame |
|---|---|---|---|---|---|
| `iron_helmet` | helmet | 8 | — | `iron_ingot` ×2 | iron helmet |
| `iron_chestplate` | chestplate | 14 | — | `iron_ingot` ×5 | iron chestplate |
| `iron_leggings` | leggings | 11 | — | `iron_ingot` ×4 | iron leggings |
| `iron_boots` | boots | 7 | — | `iron_ingot` ×2 | iron boots |
| `iron_gloves` | gloves | 5 | — | `iron_ingot` ×1 + `leather` ×1 | iron gloves |

**Tier 4 — Dungeon Altar · Level 12** *(Shadow — dungeon-only materials)*

| Armor | Slot | Defense | Special | Recipe | Sprite frame |
|---|---|---|---|---|---|
| `shadow_helmet` | helmet | 12 | lifesteal 5% | `ectoplasm` ×2 + `iron_ingot` ×2 | shadow helmet |
| `shadow_chestplate` | chestplate | 20 | lifesteal 5% | `ectoplasm` ×4 + `iron_ingot` ×3 | shadow chestplate |
| `shadow_leggings` | leggings | 16 | — | `ectoplasm` ×3 + `iron_ingot` ×2 | shadow leggings |
| `shadow_boots` | boots | 10 | +movement speed | `ectoplasm` ×2 + `iron_ingot` ×1 | shadow boots |
| `shadow_gloves` | gloves | 8 | +5 flat power | `ectoplasm` ×2 + `dark_crystal` ×1 | shadow gloves |

---

## Village Shop

Each village contains one **shop** operated by a `merchant_standard` NPC at the `market_stall` tile. Players interact to open a buy/sell panel.

### Stock

| Category | Items available |
|---|---|
| Armors | Tier 1 (leather) always; Tier 2 (chitin) at level 4+; Tier 3 (iron) at level 8+ |
| Weapons | All Tier 1; selected Tier 2 weapons (no Tier 3/4 — forge/altar only). Includes starter bows and entry elemental magic weapons/catalysts |
| Materials | `wood`, `stone`, `fiber`, `hide`, `bone`, `iron_ore`, `chitin`, `mushroom`, `flower` |

Tier 4 items are never sold in shops — dungeon altar crafting only.

### Pricing

- Each item has a `baseBuyPrice` in `gold`. The sell price is 50% of the buy price.
- A **zone multiplier** adjusts prices based on the village's surrounding zone:

| Zone | Cheaper (×0.7) | More expensive (×1.4) |
|---|---|---|
| **Plains** | `hide`, `meat`, `bone` | `chitin`, `sand_crystal` |
| **Forest** | `wood`, `fiber`, `mushroom`, leather armor | `iron_ore`, `iron_ingot` |
| **River** | `leather`, `fiber`, `reeds` | `stone`, `iron_ore` |
| **Desert** | `chitin`, `sand_crystal`, chitin armor | `wood`, `fiber` |

- Each village also applies a **±15% random jitter** seeded from its POI seed, so two forest villages may still have slightly different prices for the same item.
- Rare items (`mana_crystal`, `ancient_wood`, `dark_crystal`) have limited stock (1–3 per real-time day) tracked in Firebase under `shops/{villageId}/limitedStock`.

---

## Objectives

- Kill enemies to gain XP and loot.
- Explore the world to find dungeons, villages, and rare materials.
- Collect natural materials and craft progressively stronger weapons.
- Clear dungeon floors to reach the boss room and obtain rare crafting materials.
- Reach level 10 to unlock PVP combat with other players.

---

## Viewport & Scaling

### Base resolution
- The game renders at a **fixed logical resolution of 640×360 pixels** (16:9). All tiles, sprites, and HUD elements are sized against this base.
- At 640×360 with 16×16 tiles, exactly **40 tiles wide × ~22 tiles tall** are visible at the default 1× zoom — enough context to see nearby threats and navigate without the world feeling overwhelming.

### Scaling to the browser window
- Phaser is configured with `ScaleManager` mode **`FIT`**: the canvas is scaled up (integer or fractional) to fill the browser window while preserving the 16:9 aspect ratio. Letterbox bars (CSS `background: #000`) fill any leftover space.
- The canvas is always centred horizontally and vertically.
- On window resize the scale factor is recalculated immediately with no reload.
- Minimum rendered tile size on screen is **3 × 3 CSS pixels** — below this the canvas refuses to scale down further.

### Pixel-art rendering
- `pixelArt: true` in Phaser config ensures nearest-neighbour upscaling. No CSS `image-rendering` override is needed beyond what Phaser sets automatically.
- All sprites and tiles are drawn at their native 16×16 size in logical pixels; the ScaleManager's CSS transform does the rest.

### Camera zoom
- Default camera zoom is **1×** (each logical pixel maps to one canvas pixel before the ScaleManager's `FIT` transform). At 16×16 tiles this shows the full 40×22-tile viewport described above.
- Players can adjust zoom between **1× and 4×** via the scroll wheel. The zoom is clamped to integer values to preserve pixel alignment.
- Zoom preference is persisted in `localStorage` (`rpidigo.zoom`) and restored on next session.

### Mobile / touch
- On viewport widths below **640 CSS pixels** the HUD switches to a compact layout: chat panel collapses to a single-line ticker; mini-map shrinks to 64×64; action buttons move to a bottom toolbar.
- WASD input is replaced by an on-screen **virtual joystick** rendered in `HudScene` on touch devices: a circular base (bottom-left) with a draggable knob; supports 8-directional movement including diagonals; knob snaps back to centre on release.
- Tap on an adjacent tile or entity triggers interaction (equivalent to keyboard interact key).

### Overlay screens (non-game scenes)
- `LoginScene`, `LoadingScene`, `IntroScene`, and all overlay scenes (`InventoryScene`, `ShopScene`, etc.) use **DOM-based UI** rendered over the Phaser canvas via a transparent HTML layer. Elements are sized in `em`/`%` units and reflow naturally with the browser window — no fixed pixel dimensions.
- The maximum width of any modal panel is capped at **480px** so it never dominates a wide display.

---

## Screens

The game is built as a set of Phaser scenes. Scenes stack additively where noted (the UI and game world render simultaneously); otherwise they replace each other. The flow between screens is described below each entry.

---

### Introduction Screen (`IntroScene`)
Displayed once on first page load before any Firebase call is made.

**Content:**
- Full-screen screenshot background (darkened overlay for readability)
- Game title **DIGON** in large gold monospace lettering
- Short tagline
- **Play** button → `LoginScene`
- **How to Play** button → `InstructionsScene`

**Transitions:**
- **Play** → `LoginScene`
- **How to Play** → `InstructionsScene`

---

### Instructions Screen (`InstructionsScene`)
Accessible from the title screen. No Firebase call required — sprites are
loaded directly from PNG files using the HTML Canvas API (frame 0, 16×16).

**Content:**
- **Controls**: WASD/arrows = move; **A** = Action (attack · interact · open · gather · talk); **I** = Inventory; **Enter** = Chat; **Esc** = close overlay
- **World**: biomes, buildings, dungeons — sprite examples
- **Combat**: face enemy + press A; XP and loot on kill; PVP at level 10+
- **NPCs**: Healer, Merchant, Guard, Dog — each with frame-0 sprite
- **Gathering & Crafting**: press A on resources; workbench/workshop/dungeon altar
- **Chests**: shared by all players; personal house chest is private storage; in chest UI, `A` takes all, and pressing `A` on an already-empty chest closes the panel
- **Death & Respawn**: items drop; respawn at house; compass hint to loot
- **Multiplayer**: real-time presence; proximity chat

**Transitions:**
- **← Back** / **Esc** → `IntroScene`

---

### Login / Register Screen (`LoginScene`)
Handles both account creation and returning-player login with a single form.

**Content:**
- Name field
- Password field
- **Login** button and **Create account** button
- Error message area (wrong password, name taken, etc.)

**Transitions:**
- Successful login or registration → `LoadingScene` (world bootstrap check)

---

### Loading / World Bootstrap Screen (`LoadingScene`)
Shown while assets are preloaded and world generation status is checked.

**Content:**
- Progress bar
- Status label: *"Loading assets…"*, *"Generating world…"*, *"Joining world…"*
- If `config/world/status === 'generating'`: polls Firebase until `status === 'ready'`
- If `status === 'empty'`: this client starts world generation and shows generation progress

**Transitions:**
- World ready + assets loaded → `GameScene` + `HudScene` (stacked)

---

### Game Screen (`GameScene`)
The main gameplay view. Always running during play; never replaced — other screens overlay or stack on top.

**Content:**
- Dynamic tile-map rendered via `ChunkManager` + `TilemapRenderer`
- Entity sprites (players, NPCs, enemies, loot pickups)
- Camera following the local player with smooth lerp; zoom 1×–4× (see *Viewport & Scaling*)
- Click/tap on adjacent entity or tile triggers interaction (NPC talk, chest open, gather)
- Canvas fills the browser window via Phaser `ScaleManager` `FIT` mode; aspect ratio 16:9 always preserved

**Transitions:**
- Death → `DeathScene` overlays
- Enter dungeon entrance tile → room transition within `GameScene` (no scene change)
- Enter house tile → room transition within `GameScene`
- ESC / menu button → `PauseScene` overlays

---

### HUD Screen (`HudScene`) — *always stacked over `GameScene`*
Persistent overlay drawn above the game world at all times during play.

**Content:**
- HP bar and MP bar (top-left)
- Level badge and XP progress bar
- Gold counter
- Equipped weapon icon (bottom-right quick-slot)
- Mini-map (top-right corner) showing explored tiles and nearby POI icons
- Chat panel (bottom-left): proximity messages, NPC speech, system notifications
- Action buttons: **Inventory**, **Menu**

**Transitions:**
- **Inventory** button → `InventoryScene` overlays
- **Menu** button → `PauseScene` overlays
- Level-up event → `LevelUpScene` overlays

---

### Inventory Screen (`InventoryScene`) — *overlays `GameScene` + `HudScene`*
Pauses entity script execution while open. Player cannot move.

**Content:**
- Grid of inventory slots with item icons and stack counts
- Five armor slots shown as a character silhouette (helmet, chestplate, leggings, boots, gloves) — click to unequip
- Weapon slot — click to unequip
- Click an item to see its tooltip (name, stats, level requirement)
- **Equip** / **Drop** / **Use** context actions on selected item
- **Close** button

**Transitions:**
- **Close** / ESC → back to `GameScene` + `HudScene`
- Click equipped weapon slot while near `workbench` or `workshop` → `CraftScene` overlays

---

### Crafting Screen (`CraftScene`) — *overlays `GameScene` + `HudScene`*
Opens when the player interacts with a `workbench`, `workshop`, or `dungeon_altar`.

**Content:**
- Station label (Workbench / Workshop / Dungeon Altar)
- Scrollable list of unlocked recipes for this station at the player's level
- Selected recipe shows: result item name, power/defense, ingredients with have/need counts (ingredients the player lacks are shown in red)
- **Craft** button (greyed out if ingredients are missing or level requirement not met)
- **Process** tab (Smelt / Tan / Brew / Refine) for intermediate material conversion
- **Close** button

**Transitions:**
- **Close** / ESC → back to `GameScene` + `HudScene`

---

### Shop Screen (`ShopScene`) — *overlays `GameScene` + `HudScene`*
Opens when the player interacts with a `merchant_standard` NPC.

**Content:**
- Two tabs: **Buy** and **Sell**
- **Buy tab:** scrollable grid of shop stock; items locked above the player's level are shown greyed out; each item shows name, icon, buy price in gold; limited-stock items show remaining quantity
- **Sell tab:** mirrors the player's inventory; each item shows its sell value (50 % of buy price); **Sell** button per item
- Player's current gold shown in header
- **Close** button

**Transitions:**
- **Close** / ESC → back to `GameScene` + `HudScene`

---

### NPC Dialog Screen (`DialogScene`) — *overlays `GameScene` + `HudScene`*
Opens when a non-merchant NPC speaks (villager, healer, guard, gossiper).

**Content:**
- NPC portrait (sprite) and name label
- Speech bubble with the NPC's current line
- **[Continue]** / **[Close]** buttons
- Healer variant: shows "HP and MP restored to full" confirmation before closing

**Transitions:**
- **[Close]** / ESC → back to `GameScene` + `HudScene`
- Merchant NPC → `ShopScene` instead of `DialogScene`

---

### Quest Log Screen (`QuestScene`) — *overlays `GameScene` + `HudScene`*
Opened anytime by pressing **`Q`**, tapping the **Q** HUD toolbar button (top-right, left of ☰), or tapping the **Q** button in the touch dpad column (tablet mode).

**Two-tab layout:**

**Quests tab** (default)
- Two category cards displayed in order: ⚔ Combat, 🪵 Gathering & Crafting.
- Each card shows:
  - Category label + `X / N quests completed` (or "All N complete!" when done).
  - Current active quest title and description.
  - Per-objective progress bar with `current / goal` fraction.
  - Reward line: `Reward: XP [+ Gold]`.
- One quest per category is active at a time; completing it auto-advances to the next (higher `order`) quest in that category, immediately re-checking the new quest so any already-met follow-ups complete in a chain too.
- New players start with the easiest quest in every category automatically.
- Reward XP follows a softened-exponential curve shared by both categories (15 → 220 XP across 13 steps, +50 gold on the final quest of each category).

**Counters tab**
- Reads `players/{id}/progressCounters` from Firebase on open.
- Renders every present key with a human-readable label; unknown keys display the raw key name.
- Map-type counters (`killsByEnemyId`, `craftedByItemId`, `collectedByItemId`) expand as sorted `id: count` sub-lists.

| Counter key | Label | Written by |
|---|---|---|
| `enemiesKilledTotal` | Enemies defeated | Enemy kill |
| `killsByEnemyId` | Kills by enemy type | Enemy kill |
| `goldCollectedTotal` | Total gold collected | Enemy kill |
| `collectedByItemId` | Items collected | Enemy loot drop / tile gathering |
| `houseEntered` | House entries | Room entry |
| `dungeonsVisited` | Dungeons entered | Room entry |
| `craftsDone` | Crafts completed | Craft action |
| `craftedByItemId` | Crafted items | Craft action |
| `chatMessagesSent` | Chat messages sent | Chat send |
| `deaths` | Deaths | Player death |
| `distanceTraveled` | Distance traveled (tiles) | Movement (flushed every 30 s) |

**Controls:**
- **[Quests]** / **[Counters]** tab buttons
- **[Close]** button
- `Q` or `Esc` keyboard shortcut

**Transitions:**
- **Close** / `Q` / `Esc` → back to `GameScene` + `HudScene`

---

### Level-Up Screen (`LevelUpScene`) — *overlays `GameScene` + `HudScene`*
Shown immediately when the player gains a level.

**Content:**
- "Level Up!" banner with new level number
- Stat distribution panel: Strength (`STR`), Dexterity (`DEX`), Intelligence (`INT`), Vitality (`VIT`) — each with a **+** button
- Number of unspent stat points shown; **+** buttons disabled when none remain
- Level reward rule: 3 points per level, plus +1 bonus point every 5 levels
- Live preview panel for derived values (melee/ranged/magic power, defense, crit chance)
- New recipe or ability unlocked at this level (if any), listed as a brief notification
- **Confirm** button (only enabled when all points are spent)

**Transitions:**
- **Confirm** → back to `GameScene` + `HudScene`

---

### Character Stats Screen (`StatsScene`) — *overlays `GameScene` + `HudScene`*
Opened anytime by pressing **`S`** during play (same overlay style as `LevelUpScene`/`PauseScene`).

**Content:**
- Player name and current level
- Strength (`STR`), Dexterity (`DEX`), Intelligence (`INT`), Vitality (`VIT`) values
- Live preview panel for derived combat values (melee/ranged/magic power, defense, crit chance)
- If the player has unspent stat points (e.g. skipped at a previous level-up): the same +/− allocation, live-preview, and **Confirm** flow as the Level-Up Screen, so banked points are never stranded
- **Log Out** button (writes `online: false` to Firebase, removes presence entry, returns to `LoginScene`)

**Transitions:**
- **Confirm** (when allocating) → applies allocation, stays in `GameScene` + `HudScene`
- ESC or **`S`** → back to `GameScene` + `HudScene`
- **Log Out** → `LoginScene`

---

### Pause Screen (`PauseScene`) — *overlays everything*
Accessible from HUD during play.

**Content:**
- **Resume** button
- **Settings** button (audio volume, key-binding display)
- **Log Out** button (writes `online: false` to Firebase, removes presence entry, returns to `LoginScene`)

**Transitions:**
- **Resume** / ESC → back to `GameScene` + `HudScene`
- **Log Out** → `LoginScene`

---

### Death Screen (`DeathScene`) — *overlays `GameScene` + `HudScene`*
Shown when the player's HP reaches zero.

**Content:**
- Darkened vignette over the game world
- "You Died" title
- Brief summary: killer name (enemy type or player name), gold retained, items lost
- **Respawn at House** button (always available)
- Countdown timer showing when auto-respawn triggers (10 seconds)

**Transitions:**
- **Respawn** or timer expiry → player teleported to house position; `DeathScene` dismissed; back to `GameScene` + `HudScene`

---

### Screen flow summary

```
IntroScene
  ├─► InstructionsScene ──────────────────────────────────────► IntroScene
  └─► LoginScene
        └─► LoadingScene
              └─► GameScene ◄────────────────────────────┐
                    │  (always stacked with HudScene)     │
                    ├─► InventoryScene ──────────────────►┤
                    │     └─► CraftScene ────────────────►┤
                    ├─► ShopScene ───────────────────────►┤
                    ├─► DialogScene ─────────────────────►┤
                    ├─► QuestScene ──────────────────────►┤
                    ├─► LevelUpScene ────────────────────►┤
                    ├─► PauseScene ──────────────────────►┤
                    │     └─► LoginScene (log out)         │
                    └─► DeathScene ──────────────────────►┘
```

---

## Extensibility

The game is built on a **data-driven registry architecture**. All content types — tiles, enemies, zones, items, weapons, and recipes — are defined as plain data objects loaded at startup. The engine depends only on content interfaces, never on specific IDs.

- Adding a new tile, enemy, zone, weapon, or enemy profile requires only adding a definition object to the appropriate data file. No engine code changes are needed.
- Adding a new enemy profile (e.g. `wolf_aggressive`, `slime_typeA`, `goblin_special1`) means adding one `EnemyDefinition` with a Python script and one entry in the zone spawn table — nothing else.
- Content can also be pushed to the Firebase `config/extensions` path to go live without redeployment. Extensions are merged into the registries at startup and override built-in definitions with the same ID.
