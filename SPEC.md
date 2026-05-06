# RPG Game — Specification

## Overview

A browser-based multiplayer RPG with a persistent shared world, real-time Firebase synchronisation, and Python-scriptable entity behaviours. There is no dedicated server — every client connects directly to the database and renders the world locally.

---

## World

### Size and structure
- The world is a fixed **1000×1000 tile grid** (coordinates 0–999 on each axis).
- The world is divided into named **zones** that determine terrain type, tiles, and enemy population.
- Tiles outside the grid boundary are impassable void.

### Lazy generation
- The world is not pre-generated. Tiles are created **on demand** as players explore.
- When a player spawns or moves, all cells within a **radius of 20 tiles** are generated if they have not been visited before.
- Generation uses deterministic noise (same seed → same tile at any coordinate on every client).
- Once a cell is written to the database it is never overwritten by generation — player modifications (chopped trees, placed houses) persist permanently.

### Zones

| Zone | Description |
|---|---|
| **Plains** | Open grassland, sparse rocks and flowers. Default zone. |
| **Forest** | Dense woodland with oak, pine and dead trees, bushes, mushrooms. |
| **River** | Flowing water channels, sandy banks, reeds, mud, bridges at crossings. |
| **Desert** | Sand dunes, cacti, dry rocks, quicksand traps, oasis pools. |
| **Village** | Structured settlement: cobblestone paths, buildings, market, blacksmith, well. |
| **Dungeon** | Underground multi-floor complex accessed via a surface entrance tile. |

- The 1000×1000 world is divided into a **10×10 grid of 100-tile sectors**. Each sector contains exactly one village and one dungeon entrance, placed at a seeded-random offset within the sector.
- Rivers are traced as connected paths following the terrain elevation gradient.

### Tiles by zone

**Plains:** `grass`, `grass_tall`, `flower_yellow`, `flower_red`, `dirt_path`, `rock_small`, `rock_large`

**Forest:** `grass_dark`, `tree_oak`, `tree_pine`, `tree_dead`, `bush`, `mushroom`, `log`, `moss_rock`, `stump`

**River:** `water_shallow`, `water_deep`, `sand_bank`, `reeds`, `bridge`, `mud`

**Desert:** `sand`, `sand_dune`, `dry_rock`, `cactus`, `dry_grass`, `oasis_water`, `quicksand`

**Village:** `cobblestone`, `house_wall`, `house_floor`, `house_door`, `house_roof`, `well`, `fence`, `market_stall`, `blacksmith_forge`, `tavern_sign`, `lantern`, `garden_plot`

**Dungeon:** `dungeon_entrance`, `dungeon_floor`, `dungeon_wall`, `dungeon_door`, `dungeon_stairs_down`, `dungeon_stairs_up`, `dungeon_torch`, `dungeon_pillar`, `dungeon_trap`, `dungeon_chest`, `dungeon_altar`

**Special:** `house` (player house entrance), `workbench`, `chest`, `void`

Some tiles reduce movement speed (`grass_tall`, `mud`, `quicksand`, `sand_dune`) rather than blocking it.

---

## Players

### Registration and login
- On first visit the player enters a **name and password**. The account is created and never deleted, even when the player is offline.
- On subsequent visits the player logs in with the same name and password to resume with the same character.
- Passwords are stored as SHA-256 hashes.

### Attributes
- **Level** — increases by gaining XP from killing enemies and collecting treasure.
- **HP / Max HP** — health points. Player respawns at their house when HP reaches zero.
- **MP / Max MP** — mana points consumed by magic weapons.
- **Stats** — Strength, Agility, Intelligence, Endurance. Points are awarded on level-up.
- **Power** — effective attack value: `base_strength × 2 + equipped_weapon_power`.
- **Defense** — incoming damage reduction: `endurance × 0.5 + total equipped armor defense`. Minimum 1 damage always applies regardless of defense total.
- **Inventory** — a list of collected items and quantities.
- **Equipped weapon** — one weapon slot; determines power and attack type.
- **Equipped armor** — five independent slots: `helmet`, `chestplate`, `leggings`, `boots`, `gloves`. Each piece adds `defense` and may carry a special effect (speed boost, lifesteal, or flat power bonus).
- **Gold** — currency stored as a dedicated counter separate from inventory. Gained from enemy drops, treasure chests, and selling items. Used to purchase items at village shops.

### Spawn and house
- On first login the player is placed at a **random position** within the world grid (with a 50-tile margin from world edges).
- A **house tile** is automatically placed within 5 tiles of the spawn point on a grass cell. The player does not choose or build the house — it is always there from the start.
- The house position is fixed for the life of the character.
- Entering the house tile transitions into a small **interior room** containing a `workbench` and a personal storage chest.
- The house is also the **respawn point** after death.

### Death and respawn
- On death the player drops all inventory items at their current position as loot. Gold is **not** dropped — it is stored separately and survives death.
- The player respawns at their house with 50% HP. The character and its data are never deleted.

### PVP
- Players can attack other players only when **both are level 10 or above**.

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
| `thief.weak` | 5–15 gold | Steals on first hit, flees immediately; fast — kill it before it escapes |
| `bandit.strong` | 10–25 gold | Steals on each hit while fighting; drops stolen gold on death |
| `desert_bandit.strong` | 15–35 gold | Steals on each hit; drops stolen gold on death |
| `goblin_scout.strong` | 3–8 gold | Steals while calling allies; drops stolen gold on death |

- A player can never be reduced below 0 gold — the enemy takes `min(stealAmount, player.gold)`.
- The chat panel shows a system notification when gold is stolen: *"Thief stole 12 gold from you!"*

---

## NPCs

NPCs use the same `{baseType}.{profile}` system as enemies. Each profile has its own Python behaviour script. Conversations are triggered when a player walks adjacent to the NPC.

### Built-in NPC profiles

| Profile | Behaviour |
|---|---|
| `villager.wanderer` | Roams the village in a small radius around a home position; greets players with random lines |
| `villager.hunter` | Patrols the forest edge near the village; shares warnings about nearby enemies |
| `villager.fisherman` | Stays near river or water tiles; shares river and water-zone knowledge |
| `villager.gossiper` | Stands near the village well; shares world knowledge — dungeon locations, treasure hints, boss sightings, directions to other villages |
| `healer.standard` | Restores the player's HP and MP to full when the player walks adjacent; no cost |
| `merchant.standard` | Runs the village shop; opens a buy/sell UI when the player interacts; stocks armors, Tier 1–2 weapons, and common materials; prices vary by village zone and per-village seed |
| `guard.patrol` | Patrols the village entry path; warns players about dangers outside |

### Gossiper knowledge

The gossiper NPC reads from `world/meta/pois` to generate contextual tips:
- **Dungeon locations** — gives approximate coordinates of the nearest unvisited dungeons
- **Village directions** — gives compass direction and rough distance to other villages
- **Boss sightings** — warns about powerful enemies spotted nearby
- **Treasure hints** — generic hints about loot-dense areas (desert chests, dungeon altars)

### Healer

The healer uses `actions.heal(playerId, hp, mp)` in its Python script to write the player's HP and MP back to their Firebase entry, clamped to `maxHp`/`maxMp`. No gold cost is required (can be added as a future extension).

### New NPC profiles

Adding a new NPC profile requires only a new `NpcDefinition` with a Python script — no engine changes. Any behaviour achievable in Python (trade, quest-giving, mini-game, escort) can be expressed as a new profile.

---

## Enemies

Each enemy has HP, MP, Power and a **state machine**: `idle`, `patrol`, `chase`, `attack`, `flee`, `dead`.

### Behaviour profiles

Every enemy type supports **named behaviour profiles** identified by `{baseType}.{profile}`. The profile label is a free-form string — `aggressive`, `coward`, `typeA`, `special1`, `berserker`, `healer`, or anything descriptive. There is no required naming convention.

Each profile is a fully independent template with its own stats and its own Python behaviour script. Profiles of the same base type share a display name and sprite, so two enemies that look identical to the player can behave completely differently:

| Profile ID | Behaviour |
|---|---|
| `wolf.coward` | Flees any player on sight |
| `wolf.aggressive` | Chases and attacks; only flees at HP < 15% |
| `slime.typeA` | Moves away from the player; never attacks |
| `slime.corrosive` | Chases and attacks; corrodes the player's armour on hit |
| `goblin.special1` | Patrols and calls nearby goblins when it spots a player |
| `necromancer.standard` | Keeps distance; ranged spell attack |
| `necromancer.summoner` | Keeps distance; re-spawns nearby dead skeletons every 10 s |

A base type can have one profile or many. The zone spawn table lists which profile IDs appear in that zone and at what relative weight — for example 50% `wolf.coward`, 30% `wolf.aggressive`, 20% `wolf.berserker` in the Forest zone.

### Enemy types by zone

Enemies are zone-specific — they spawn only in their adapted zones:

| Base type | Zone | Variants |
|---|---|---|
| `wolf` | Plains, Forest | `.weak`, `.strong` |
| `bandit` | Plains | `.weak`, `.strong` *(strong variant steals gold)* |
| `giant_spider` | Forest | `.weak`, `.venomous` |
| `goblin_scout` | Forest | `.weak`, `.strong` |
| `treant` | Forest | `.strong` |
| `river_troll` | River | `.weak`, `.strong` |
| `crocodile` | River | `.weak` |
| `water_spirit` | River | `.weak`, `.enraged` |
| `scorpion` | Desert | `.weak`, `.giant` |
| `sand_worm` | Desert | `.weak` |
| `mummy` | Desert | `.weak` |
| `desert_bandit` | Desert | `.strong` *(steals gold on hit)* |
| `thief` | Village outskirts | `.weak` *(steals gold on hit)* |
| `dark_mage` | Village outskirts | `.weak`, `.strong` |
| `skeleton` | Dungeon floor 1 | `.weak` |
| `slime` | Dungeon floor 1 | `.weak`, `.corrosive` |
| `zombie` | Dungeon floor 1 | `.weak`, `.armoured` |
| `dark_knight` | Dungeon floor 2+ | `.weak`, `.elite` |
| `ghost` | Dungeon floor 2+ | `.weak`, `.enraged` — passes through walls; immune to physical weapons |
| `necromancer` | Dungeon floor 2+ | `.weak`, `.strong` |
| `dungeon_boss` | Dungeon boss room | `.strong` — one per dungeon; locks room on aggro; guaranteed rare loot |

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

## Distributed script execution

- There is no server. **The nearest online player client executes scripts** for offline players, NPCs, and enemies within a configurable maximum distance.
- If no player is online within range, entities do not act.
- A client claims execution ownership of nearby entities by writing its player ID to the entity record. Ownership is released on disconnect.
- Scripts run in a sandboxed Python environment (Pyodide WASM) with access to entity state, nearby world data, and a set of actions (`move`, `attack`, `speak`, `setState`). No file or network access is permitted.

---

## World persistence

Game state is split across purpose-built Firebase Realtime Database collections. Each collection has a single responsibility and its own security scope.

| Collection | Responsibility | Write frequency |
|---|---|---|
| `/config` | World seed, POI layout, content extension registry | Written once; read at startup |
| `/map/{room}/{x}_{y}` | Tile data — type, variant, metadata | Written once at generation; rarely modified |
| `/players/{id}` | Full canonical player state including position | Written on every player action |
| `/entities/npcs/{id}` | Full NPC state including position | Written on every script tick |
| `/entities/enemies/{id}` | Full enemy state including position | Written on every script tick |
| `/presence/{room}` | Lightweight render snapshot (x, y, sprite, state) for all entities in a room | Written on every move; Phaser subscribes here |
| `/chat/{room}` | Proximity chat messages | Append-only; pruned after 5 minutes |
| `/shops/{villageId}` | Per-village limited stock counters and restock timestamp | Written on each purchase of a limited item |

**Separation of canonical state from render state:** `/players/{id}` and `/entities/` hold full data. `/presence/{room}` holds only what the renderer needs (position, sprite, HP bar value, state label). A player move writes only the coordinates to both paths — no full-document copy or delete is needed.

**Entity movement:** Position is a field on the entity's own document (`/players/{id}/x`, `/players/{id}/y`, `/players/{id}/room`). On move, only those three fields are updated (plus the matching entry in `/presence/{room}`). If the room changes, the old presence entry is removed and a new one is written. No full-document remove-and-rewrite occurs.

**Tile persistence:** Once a cell is written to `/map` it is never overwritten by generation — player modifications (chopped trees, placed houses) persist permanently.

**Extensibility:** New content types (mounts, guilds, quests) get their own top-level collection without touching existing paths. Runtime content additions go under `/config/extensions/` and are merged into registries at startup.

---

## Resources and gathering

Players can gather raw materials from the world by interacting with specific tiles:

| Action | Tile | Material obtained |
|---|---|---|
| Chop | `tree_oak`, `tree_pine` | `wood` |
| Chop | `tree_dead` | `wood`, `fiber` |
| Cut | `bush`, `reeds` | `fiber` |
| Cut | `cactus` | `fiber` |
| Mine | `rock_large`, `moss_rock`, `dry_rock` | `stone` |
| Mine | `rock_large` (rare) | `iron_ore` |
| Mine | `dry_rock` (rare) | `iron_ore` |
| Pick | `mushroom` | `mushroom` |
| Pick | `flower_yellow`, `flower_red` | `flower` |

Enemy drops also provide materials: `hide`, `bone`, `chitin`, `silk`, `crystal`, `ancient_wood`, `mana_crystal`, `ectoplasm`, `dark_crystal`, `slime_gel`, `poison_sac`, and others.

After gathering, the source tile changes to a depleted form and regenerates automatically after a timer.

---

## Crafting and weapons

### Crafting stations

| Station | Location | Purpose |
|---|---|---|
| `workbench` | Inside player house | Basic weapons and tools from natural materials |
| `blacksmith_forge` | Village | Metal weapons; smelting `iron_ore` into `iron_ingot` |
| `dungeon_altar` | Dungeon boss room | Rare and magic weapons from dungeon materials |

### Intermediate processing

Some recipes require processed materials:

| Process | Input | Output | Station |
|---|---|---|---|
| Smelt | `iron_ore` ×3 | `iron_ingot` ×1 | `blacksmith_forge` |
| Tan | `hide` ×2 + `fiber` ×1 | `leather` ×1 | `workbench` |
| Brew | `poison_sac` ×1 + `mushroom` ×1 | `poison_vial` ×2 | `workbench` |
| Refine | `sand_crystal` ×2 + `stone` ×1 | `refined_crystal` ×1 | `blacksmith_forge` |

### Weapons

Most weapons are crafted at stations using gathered materials. Tier 1 and Tier 2 weapons are also stocked in village shops for players who prefer to buy rather than craft. Armor can be crafted or purchased.

**Tier 1 — Workbench · Level 1** *(Forest & Plains materials)*

| Weapon | Power | Type | Recipe |
|---|---|---|---|
| `wooden_sword` | 8 | melee | `wood` ×5 + `fiber` ×2 |
| `stone_mace` | 11 | melee | `stone` ×4 + `wood` ×2 |
| `bone_dagger` | 9 | melee | `bone` ×3 + `fiber` ×1 |
| `hunting_bow` | 10 | ranged | `wood` ×4 + `fiber` ×3 + `hide` ×2 |
| `wooden_staff` | 7 | magic | `wood` ×3 + `mushroom` ×2 |
| `stone_pick` | 6 | tool | `stone` ×3 + `wood` ×2 |
| `stone_axe` | 8 | tool | `stone` ×3 + `wood` ×2 |

**Tier 2 — Workbench · Level 4** *(Desert & River materials)*

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `chitin_blade` | 15 | melee | — | `chitin` ×4 + `stone` ×2 |
| `silk_whip` | 13 | melee | hits 2 tiles | `silk` ×3 + `wood` ×2 |
| `poison_dagger` | 11 | melee | poison on hit | `wood` ×3 + `poison_sac` ×2 |
| `vine_staff` | 12 | magic | slows target | `ancient_wood` ×2 + `mushroom` ×3 |
| `crystal_wand` | 14 | magic | — | `crystal` ×2 + `wood` ×2 |
| `bone_bow` | 13 | ranged | — | `bone` ×3 + `fiber` ×3 + `wood` ×2 |
| `leather_sling` | 10 | ranged | area (3 tiles) | `leather` ×2 + `fiber` ×2 |

**Tier 3 — Blacksmith Forge · Level 8** *(Metal — requires `iron_ingot`)*

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `iron_sword` | 20 | melee | — | `iron_ingot` ×4 |
| `iron_axe` | 22 | melee | instant chop | `iron_ingot` ×3 + `wood` ×1 |
| `iron_spear` | 18 | melee | range 2 tiles | `iron_ingot` ×2 + `wood` ×3 |
| `iron_bow` | 19 | ranged | — | `iron_ingot` ×2 + `fiber` ×4 |
| `iron_staff` | 20 | magic | — | `iron_ingot` ×2 + `mana_crystal` ×1 |
| `sand_lance` | 25 | melee | — | `chitin` ×3 + `refined_crystal` ×2 |

**Tier 4 — Dungeon Altar · Level 12** *(Rare — dungeon-only materials)*

| Weapon | Power | Type | Special | Recipe |
|---|---|---|---|---|
| `shadow_blade` | 28 | melee | lifesteal 10% | `iron_ingot` ×4 + `ectoplasm` ×2 |
| `soul_staff` | 26 | magic | AOE burst | `ancient_wood` ×2 + `mana_crystal` ×3 + `ectoplasm` ×1 |
| `dark_bow` | 30 | ranged | pierces enemies | `iron_ingot` ×2 + `dark_crystal` ×1 + `fiber` ×3 |
| `slime_launcher` | 16 | ranged | area + slows | `slime_gel` ×5 + `wood` ×3 |
| `necro_staff` | 28 | magic | summons skeleton | `bone` ×5 + `mana_crystal` ×2 + `ectoplasm` ×3 |
| `boss_blade` | 35 | melee | — | `boss_key` ×1 + `iron_ingot` ×6 + `dark_crystal` ×2 |

### Armors

Armor is crafted at stations or bought in village shops. Each piece occupies one of five slots and adds `defense` to the player's damage-reduction total.

**Tier 1 — Workbench · Level 1** *(Leather — hide & fiber)*

| Armor | Slot | Defense | Recipe |
|---|---|---|---|
| `leather_helmet` | helmet | 2 | `hide` ×1 + `fiber` ×2 |
| `leather_chestplate` | chestplate | 4 | `leather` ×3 + `fiber` ×2 |
| `leather_leggings` | leggings | 3 | `leather` ×2 + `fiber` ×2 |
| `leather_boots` | boots | 2 | `leather` ×1 + `fiber` ×2 |
| `leather_gloves` | gloves | 1 | `hide` ×1 + `fiber` ×1 |

**Tier 2 — Workbench · Level 4** *(Chitin — desert & river materials)*

| Armor | Slot | Defense | Special | Recipe |
|---|---|---|---|---|
| `chitin_helmet` | helmet | 5 | — | `chitin` ×2 + `leather` ×1 |
| `chitin_chestplate` | chestplate | 9 | — | `chitin` ×4 + `leather` ×2 |
| `chitin_leggings` | leggings | 7 | — | `chitin` ×3 + `leather` ×1 |
| `chitin_boots` | boots | 4 | — | `chitin` ×2 |
| `chitin_gloves` | gloves | 3 | — | `chitin` ×1 + `fiber` ×1 |

**Tier 3 — Blacksmith Forge · Level 8** *(Iron — requires `iron_ingot`)*

| Armor | Slot | Defense | Special | Recipe |
|---|---|---|---|---|
| `iron_helmet` | helmet | 8 | — | `iron_ingot` ×2 |
| `iron_chestplate` | chestplate | 14 | — | `iron_ingot` ×5 |
| `iron_leggings` | leggings | 11 | — | `iron_ingot` ×4 |
| `iron_boots` | boots | 7 | — | `iron_ingot` ×2 |
| `iron_gloves` | gloves | 5 | — | `iron_ingot` ×1 + `leather` ×1 |

**Tier 4 — Dungeon Altar · Level 12** *(Shadow — dungeon-only materials)*

| Armor | Slot | Defense | Special | Recipe |
|---|---|---|---|---|
| `shadow_helmet` | helmet | 12 | lifesteal 5% | `ectoplasm` ×2 + `iron_ingot` ×2 |
| `shadow_chestplate` | chestplate | 20 | lifesteal 5% | `ectoplasm` ×4 + `iron_ingot` ×3 |
| `shadow_leggings` | leggings | 16 | — | `ectoplasm` ×3 + `iron_ingot` ×2 |
| `shadow_boots` | boots | 10 | +movement speed | `ectoplasm` ×2 + `iron_ingot` ×1 |
| `shadow_gloves` | gloves | 8 | +5 flat power | `ectoplasm` ×2 + `dark_crystal` ×1 |

---

## Village Shop

Each village contains one **shop** operated by a `merchant.standard` NPC at the `market_stall` tile. Players interact to open a buy/sell panel.

### Stock

| Category | Items available |
|---|---|
| Armors | Tier 1 (leather) always; Tier 2 (chitin) at level 4+; Tier 3 (iron) at level 8+ |
| Weapons | All Tier 1; selected Tier 2 weapons (no Tier 3/4 — forge/altar only) |
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
- Rare items (`mana_crystal`, `ancient_wood`, `dark_crystal`) have limited stock (1–3 per real-time day) tracked in Firebase under `world/shops/{villageId}/limitedStock`.

---

## Objectives

- Kill enemies to gain XP and loot.
- Explore the world to find dungeons, villages, and rare materials.
- Collect natural materials and craft progressively stronger weapons.
- Clear dungeon floors to reach the boss room and obtain rare crafting materials.
- Reach level 10 to unlock PVP combat with other players.

---

## Extensibility

The game is built on a **data-driven registry architecture**. All content types — tiles, enemies, zones, items, weapons, and recipes — are defined as plain data objects loaded at startup. The engine depends only on content interfaces, never on specific IDs.

- Adding a new tile, enemy, zone, weapon, or enemy profile requires only adding a definition object to the appropriate data file. No engine code changes are needed.
- Adding a new enemy profile (e.g. `wolf.aggressive`, `slime.typeA`, `goblin.special1`) means adding one `EnemyDefinition` with a Python script and one entry in the zone spawn table — nothing else.
- Content can also be pushed to the Firebase `world/meta/extensions` path to go live without redeployment. Extensions are merged into the registries at startup and override built-in definitions with the same ID.
