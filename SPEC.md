# RPG Game — Specification

## Overview

A browser-based multiplayer RPG with a persistent shared world, real-time Firebase synchronisation, and Python-scriptable entity behaviours. The world is generated **lazily in 32×32-tile chunks** as players explore — never upfront. When a player reaches an unvisited area, the visiting client generates the chunk deterministically from the world seed and writes it to Firebase; all later clients simply read the persisted tiles. There is no dedicated server — every client connects directly to the database and renders the world locally. All entities have a script that implements their behaviour.

---

## Sprite rendering convention

All sprite sheets are **16×16-pixel grids** of animation frames. **Only frame 0 (the top-left 16×16 pixel cell) is used** for every tile, enemy, NPC, and player sprite until animation is added in a later step.

- **In Phaser** (tiles, entities, HUD): load each sheet with `frameWidth: 16, frameHeight: 16`; display with `setFrame(0)`.
- **In DOM UI** (login character selection): use a `<canvas>` element and draw the source rect `(0, 0, 16, 16)` scaled to the desired display size (e.g. 32×32) with `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)`.

This convention applies everywhere a sprite is rendered. Do not rely on the full sheet size — always address frame 0 explicitly.

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
| **Village** | Structured settlement: cobblestone paths, buildings, market, blacksmith, well. |
| **Dungeon** | Underground multi-floor complex accessed via a surface entrance tile. |

- The 1000×1000 world is divided into a **10×10 grid of 100-tile sectors**. Each sector contains exactly one village and one dungeon entrance, placed at a seeded-random offset within the sector.
- Rivers are traced as connected paths within each chunk following the local elevation gradient.
- Road paths between all POIs are pre-computed from the seed. When a chunk containing a road segment is generated, road tiles (`dirt_path`, `cobblestone`, or `bridge` over water) are stamped in, ensuring every explored POI is connected to every other explored POI by a walkable road.
- No global connectivity repair pass is needed; connectivity is guaranteed by the deterministic road network stamped at chunk-generation time.

### Tiles by zone

All sprite paths are relative to `public/assets/sprites/`.

**Plains**

| Tile | Sprite |
|---|---|
| `grass` | `Ground/Grass.png` |
| `grass_tall` | `Ground/TexturedGrass.png` |
| `flower_yellow` | `Ground/Grass.png` *(yellow flower frame)* |
| `flower_red` | `Ground/Grass.png` *(red flower frame)* |
| `dirt_path` | `Ground/DeadGrass.png` |
| `rock_small` | `Nature/Rocks.png` *(small frame)* |
| `rock_large` | `Nature/Rocks.png` *(large frame)* |

**Forest**

| Tile | Sprite |
|---|---|
| `grass_dark` | `Ground/TexturedGrass.png` |
| `tree_oak` | `Nature/Trees.png` |
| `tree_pine` | `Nature/PineTrees.png` |
| `tree_dead` | `Nature/DeadTrees.png` |
| `bush` | `Nature/Trees.png` *(bush/shrub frame)* |
| `mushroom` | `Ground/TexturedGrass.png` *(mushroom frame)* |
| `log` | `Nature/DeadTrees.png` *(log frame)* |
| `moss_rock` | `Nature/Rocks.png` *(mossy frame)* |
| `stump` | `Nature/DeadTrees.png` *(stump frame)* |

**River**

| Tile | Sprite |
|---|---|
| `water_shallow` | `Ground/Shore.png` *(shallow frame)* |
| `water_deep` | `Ground/Cliff-Water.png` |
| `sand_bank` | `Ground/Shore.png` *(sand frame)* |
| `reeds` | `Ground/Shore.png` *(reeds frame)* |
| `bridge` | `Miscellaneous/Bridge.png` |
| `mud` | `Ground/DeadGrass.png` *(mud frame)* |

**Desert**

| Tile | Sprite |
|---|---|
| `sand` | `Ground/DeadGrass.png` *(sand frame)* |
| `sand_dune` | `Ground/DeadGrass.png` *(dune frame)* |
| `dry_rock` | `Nature/Rocks.png` *(dry frame)* |
| `cactus` | `Nature/Cactus.png` |
| `dry_grass` | `Nature/Tumbleweed.png` |
| `oasis_water` | `Ground/Shore.png` *(water frame)* |
| `quicksand` | `Ground/DeadGrass.png` *(quicksand frame)* |

**Village**

| Tile | Sprite |
|---|---|
| `cobblestone` | `Ground/DeadGrass.png` *(stone path frame)* |
| `house_wall` | `Buildings/Wood/Houses.png` *(wall frame)* |
| `house_floor` | `Ground/Grass.png` *(floor frame)* |
| `house_door` | `Buildings/Wood/Houses.png` *(door frame)* |
| `house_roof` | `Buildings/Wood/Houses.png` *(roof frame)* |
| `well` | `Miscellaneous/Well.png` |
| `fence` | `Buildings/Wood/Resources.png` *(fence frame)* |
| `market_stall` | `Buildings/Wood/Market.png` |
| `blacksmith_forge` | `Buildings/Wood/Workshops.png` |
| `tavern_sign` | `Buildings/Wood/Taverns.png` |
| `lantern` | `Miscellaneous/Signs.png` *(lantern frame)* |
| `garden_plot` | `Nature/Wheatfield.png` |

**Dungeon**

| Tile | Sprite |
|---|---|
| `dungeon_entrance` | `Buildings/Wood/CaveV2.png` |
| `dungeon_floor` | `Ground/Cliff.png` *(floor frame)* |
| `dungeon_wall` | `Ground/Cliff.png` *(wall frame)* |
| `dungeon_door` | `Buildings/Wood/Houses.png` *(dungeon door frame)* |
| `dungeon_stairs_down` | `Ground/Cliff.png` *(stairs-down frame)* |
| `dungeon_stairs_up` | `Ground/Cliff.png` *(stairs-up frame)* |
| `dungeon_torch` | `Miscellaneous/Signs.png` *(torch frame)* |
| `dungeon_pillar` | `Ground/Cliff.png` *(pillar frame)* |
| `dungeon_trap` | `Buildings/Enemy/SpearWall.png` |
| `dungeon_chest` | `Miscellaneous/Chests.png` |
| `dungeon_altar` | `Buildings/Enemy/Mausoleum.png` |

**Special**

| Tile | Sprite |
|---|---|
| `house` | `Buildings/Wood/Huts.png` *(entrance frame)* |
| `workbench` | `Buildings/Wood/Workshops.png` *(bench frame)* |
| `chest` | `Miscellaneous/Chests.png` |
| `void` | `Ground/Cliff.png` *(impassable barrier frame)* |

Some tiles reduce movement speed (`grass_tall`, `mud`, `quicksand`, `sand_dune`) rather than blocking it.

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
- **Stats** — Strength, Agility, Intelligence, Endurance. Points are awarded on level-up.
- **Power** — effective attack value: `base_strength × 2 + equipped_weapon_power`.
- **Defense** — incoming damage reduction: `endurance × 0.5 + total equipped armor defense`. Minimum 1 damage always applies regardless of defense total.
- **Inventory** — a list of collected items and quantities.
- **Equipped weapon** — one weapon slot; determines power and attack type.
- **Equipped armor** — five independent slots: `helmet`, `chestplate`, `leggings`, `boots`, `gloves`. Each piece adds `defense` and may carry a special effect (speed boost, lifesteal, or flat power bonus).
- **Gold** — currency stored as a dedicated counter separate from inventory. Gained from enemy drops, treasure chests, and selling items. Used to purchase items at village shops.

### Spawn and house
- On first login the player is placed at a **random reachable passable position** within the world grid (with a 50-tile margin from world edges).
- A **house tile** is automatically placed within 5 tiles of the spawn point on a grass cell. The player does not choose or build the house — it is always there from the start.
- The house position is fixed for the life of the character.
- Entering the house tile transitions into a small **interior room** containing a `workbench` and a personal storage chest.
- The house is also the **respawn point** after death.

### Death and respawn
- On death the player drops all inventory items at their current position as loot. Gold is **not** dropped — it is stored separately and survives death.
- The player respawns at their house with 50% HP. The character and its data are never deleted.

### PVP
- Players can attack other players only when **both are level 10 or above**.

### Sprites

Players choose one of eight available champion sprites at character creation. All sprite files are under `public/assets/sprites/Characters/Champions/`. In the character-selection grid on the login screen, and as the in-game player sprite, **only frame 0 (top-left 16×16 px)** is shown — see the global [Sprite rendering convention](#sprite-rendering-convention).

The entity sprites used in the login selection UI are the pre-scaled portraits under `public/assets/sprites/entities/players/`. The Champions sheets under `Characters/Champions/` are used for in-game rendering.

| Champion | File |
|---|---|
| Arthax | `Arthax.png` |
| Börg | `Börg.png` |
| Gangblanc | `Gangblanc.png` |
| Grum | `Grum.png` |
| Kanji | `Kanji.png` |
| Katan | `Katan.png` |
| Okomo | `Okomo.png` |
| Zhinja | `Zhinja.png` |

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
| `thief_weak` | 5–15 gold | Steals on first hit, flees immediately; fast — kill it before it escapes |
| `bandit_strong` | 10–25 gold | Steals on each hit while fighting; drops stolen gold on death |
| `desert_bandit_strong` | 15–35 gold | Steals on each hit; drops stolen gold on death |
| `goblin_scout_strong` | 3–8 gold | Steals while calling allies; drops stolen gold on death |

- A player can never be reduced below 0 gold — the enemy takes `min(stealAmount, player.gold)`.
- The chat panel shows a system notification when gold is stolen: *"Thief stole 12 gold from you!"*

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

## Distributed script execution

- There is no server. **The nearest online player client executes scripts** for offline players, NPCs, and enemies within a configurable maximum distance.
- If no player is online within range, entities do not act.
- Execution ownership must always prefer the nearest eligible player client. If a different player becomes nearer, ownership may move to that nearer client to balance.
- Owned entities are refreshed in **oldest-update-first order** so the entities that have waited longest get processed first.
- Each client may refresh only a **small capped batch of entities at a time** to avoid frame drops and excessive Firebase writes.
- A client claims execution ownership by writing its player ID to the entity record. Ownership is released on disconnect or when a nearer eligible client takes over.
- Recommended scheduler rule: sort owned nearby entities by `lastLogicAt` ascending and process only the first small batch each tick window.
- Recommended default caps: refresh at most 4 enemies and 2 NPCs per scheduler slice, then continue with the next oldest entities on the following slice.
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
| Chop | `tree_dead` | `wood`, `fiber` | `User Interface/UiIcons.png` *(wood / fiber frames)* |
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
| `blacksmith_forge` | Village | Metal weapons; smelting `iron_ore` into `iron_ingot` |
| `dungeon_altar` | Dungeon boss room | Rare and magic weapons from dungeon materials |

### Intermediate processing

Some recipes require processed materials. Output sprites are frames from `User Interface/UiIcons.png` unless noted.

| Process | Input | Output | Station | Output sprite |
|---|---|---|---|---|
| Smelt | `iron_ore` ×3 | `iron_ingot` ×1 | `blacksmith_forge` | iron ingot frame |
| Tan | `hide` ×2 + `fiber` ×1 | `leather` ×1 | `workbench` | leather frame |
| Brew | `poison_sac` ×1 + `mushroom` ×1 | `poison_vial` ×2 | `workbench` | `User Interface/Icons-Essentials.png` *(vial frame)* |
| Refine | `sand_crystal` ×2 + `stone` ×1 | `refined_crystal` ×1 | `blacksmith_forge` | refined crystal frame |

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

## Viewport & Scaling

### Base resolution
- The game renders at a **fixed logical resolution of 320×180 pixels** (16:9). All tiles, sprites, and HUD elements are sized against this base.
- At 320×180 with 16×16 tiles, exactly **20 tiles wide × ~11 tiles tall** are visible at default zoom — enough context to see nearby threats and navigate without the world feeling overwhelming.

### Scaling to the browser window
- Phaser is configured with `ScaleManager` mode **`FIT`**: the canvas is scaled up (integer or fractional) to fill the browser window while preserving the 16:9 aspect ratio. Letterbox bars (CSS `background: #000`) fill any leftover space.
- The canvas is always centred horizontally and vertically.
- On window resize the scale factor is recalculated immediately with no reload.
- Minimum rendered tile size on screen is **3 × 3 CSS pixels** — below this the canvas refuses to scale down further.

### Pixel-art rendering
- `pixelArt: true` in Phaser config ensures nearest-neighbour upscaling. No CSS `image-rendering` override is needed beyond what Phaser sets automatically.
- All sprites and tiles are drawn at their native 16×16 size in logical pixels; the ScaleManager's CSS transform does the rest.

### Camera zoom
- Default camera zoom is **2×** (each logical pixel becomes 2×2 logical pixels), giving an effective tile display size of 32×32 CSS pixels at 1:1 browser zoom. This makes the game comfortable on typical desktop monitors without the world feeling enormous.
- Players can adjust zoom between **1× and 4×** via scroll-wheel or pinch gesture. The zoom is clamped to integer values to preserve pixel alignment.
- Zoom preference is persisted in `localStorage` and restored on next session.

### Mobile / touch
- On viewport widths below **640 CSS pixels** the HUD switches to a compact layout: chat panel collapses to a single-line ticker; mini-map shrinks to 64×64; action buttons move to a bottom toolbar.
- WASD input is replaced by an on-screen **D-pad** (virtual joystick) rendered in `HudScene` on touch devices.
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
- Full-screen background art (game title and atmosphere illustration)
- Game title and short tagline
- **Play** button

**Transitions:**
- **Play** → `LoginScene`

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
- Action buttons: **Inventory**, **Map**, **Menu**

**Transitions:**
- **Inventory** button → `InventoryScene` overlays
- **Map** button → `MapScene` overlays
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
- Click equipped weapon slot while near `workbench` or `blacksmith_forge` → `CraftScene` overlays

---

### Crafting Screen (`CraftScene`) — *overlays `GameScene` + `HudScene`*
Opens when the player interacts with a `workbench`, `blacksmith_forge`, or `dungeon_altar`.

**Content:**
- Station label (Workbench / Blacksmith Forge / Dungeon Altar)
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

### Map Screen (`MapScene`) — *overlays `GameScene` + `HudScene`*
Full-screen world map with fog-of-war.

**Content:**
- Zoomed-out view of the 1000×1000 grid; unexplored sectors rendered as dark fog
- Icons for: known villages (house icon), known dungeon entrances (cave icon), player's current position (pin), player's house position (star)
- Zone colour coding (plains green, forest dark-green, desert yellow, river blue)
- **Close** button

**Transitions:**
- **Close** / ESC → back to `GameScene` + `HudScene`

---

### Level-Up Screen (`LevelUpScene`) — *overlays `GameScene` + `HudScene`*
Shown immediately when the player gains a level.

**Content:**
- "Level Up!" banner with new level number
- Stat distribution panel: Strength, Agility, Intelligence, Endurance — each with a **+** button
- Number of unspent stat points shown; **+** buttons disabled when none remain
- New recipe or ability unlocked at this level (if any), listed as a brief notification
- **Confirm** button (only enabled when all points are spent)

**Transitions:**
- **Confirm** → back to `GameScene` + `HudScene`

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
  └─► LoginScene
        └─► LoadingScene
              └─► GameScene ◄────────────────────────────┐
                    │  (always stacked with HudScene)     │
                    ├─► InventoryScene ──────────────────►┤
                    │     └─► CraftScene ────────────────►┤
                    ├─► ShopScene ───────────────────────►┤
                    ├─► DialogScene ─────────────────────►┤
                    ├─► MapScene ────────────────────────►┤
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
- Content can also be pushed to the Firebase `world/meta/extensions` path to go live without redeployment. Extensions are merged into the registries at startup and override built-in definitions with the same ID.
