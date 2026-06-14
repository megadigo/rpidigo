# RPIdigo — Implementation Plan (from Spec)

> **Global sprite convention**: All sprite sheets are 16×16-pixel grids.
> - In Phaser: `this.load.spritesheet(key, path, { frameWidth: 16, frameHeight: 16 })`.
> - Tiles use frame 0.
> - Players, enemies, and NPCs use directional walk animation (5 frames per direction: down/up/right/left) and face movement direction.
> - Projectile sheets use 4 directional frames in a single row: down/up/right/left.
> - In DOM UI (login screen): `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)` on a `<canvas>`.
> Login portraits use frame 0.

## Step 1 — Firebase Setup & Title Screen ✅
*Goal: app starts, title screen is visible, Firebase connects without errors.*

1. ✅ Copy `.env.example` to `.env` and fill in real Firebase Realtime Database credentials (API key, auth domain, databaseURL, project ID, etc.).
2. ✅ **Sprite directories** — all sprites live under `public/assets/sprites/` in the following layout. Run `node scripts/gen-placeholders.cjs` to regenerate any missing placeholder PNGs:
   ```
   public/assets/sprites/
   ├── World/Ground/   terrain tiles (grass, water, sand, etc.)
   ├── World/Nature/   natural objects (trees, rocks, bushes)
   ├── Player/         champion spritesheets (80×128) + login previews
   ├── Enemies/        enemy spritesheets (80×128)
   ├── NPCs/           NPC spritesheets (80×128)
   ├── Items/          consumables, materials, keys (16×16 icons)
   ├── Projectiles/    projectile spritesheets (64×16, 4 directional frames)
   ├── Weapons/        weapon icons (16×16)
   ├── Armors/         armor icons (16×16)
   ├── Tools/          tool icons (16×16)
   ├── Dungeon/        dungeon buildings, floor, stairs, props (16×16)
   ├── House/          village buildings, house interior, furniture (16×16)
   └── Cellars/        cellar floor, walls, stairs, props (16×16)
   ```
   To force-refresh projectile sheets, run `node scripts/gen-placeholders.cjs --overwrite-projectiles`.
   All sprites are committed to the repository. This step only applies when regenerating missing placeholders on a fresh clone.
3. ✅ Publish `database.rules.json` via `firebase deploy --only database`. Rules cover `/config`, `/map`, `/players`, `/entities`, `/presence`, `/chat`, `/shops`.
4. ✅ `firebase.ts` and `registry/bootstrap.ts` are already correct — no changes needed.
5. ✅ **IntroScene** updated: game title is **DIGON**, background uses `public/screenshot.png` (darkened overlay), two buttons — **Play** → `LoginScene` and **How to Play** → `InstructionsScene`.
6. ✅ **InstructionsScene** added: full how-to-play screen with keyboard controls (`A` = Action), world, combat, NPC, gathering/crafting, death, and multiplayer sections. Sprites drawn from raw PNGs (frame 0, 16×16 → 32×32) without requiring Phaser texture loading.
7. ✅ **Action key changed from `E` to `A`** throughout: `PlayerController`, `DialogScene`, `ShopScene`, `HudScene` D-pad label.
8. ✅ **Checkpoint**: `npm run dev` opens the browser; the **DIGON** title screen appears over the screenshot; clicking **How to Play** shows the instruction screen with game sprites; clicking **Play** navigates to the login screen.

---

## Step 2 — Player Registration & Login ✅
*Goal: a new player can register with a name, password, and champion choice; an existing player can log back in.*

1. ✅ The `LoginScene`, `Auth.register`, and `Auth.login` are already implemented — verify they work end-to-end.
2. ✅ In the character-selection grid, each champion portrait is rendered via `<canvas>` using `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)` — showing only frame 0 of the entity sprite sheet, scaled 2× to 32×32.
3. ✅ Confirm `register` writes the new player record under `/players/{id}` and presence under `/presence/0/players/{id}` in the Firebase console.
4. ✅ Confirm `login` finds the player by name, checks the password hash, and restores the session.
5. ✅ **Checkpoint**: Fill in the form, press **Register**; the loading screen appears; the Firebase console shows the new player entry. Press **Login** on a second visit; the same entry is reused.

---

## Step 3 — World Bootstrap & Sprite Exploration ✅
*Goal: after login the player drops into a playable world rendered with real tile sprites and their chosen champion sprite, and can walk around.*

1. ✅ `LoadingScene.preload()` loads all tile spritesheets and all 8 champion spritesheets with `frameWidth: 16, frameHeight: 16`.
2. ✅ `TilemapRenderer` uses a pool of `Phaser.GameObjects.Image` objects; each tile type maps to its spritesheet key, displayed at frame 0.
3. ✅ `PlayerController` renders the player as a `Phaser.GameObjects.Sprite` with directional walk/attack animation (5 frames per direction) and movement-facing direction.
4. ✅ Confirm `LoadingScene` seeds the world, pre-loads spawn-area chunks (radius 2), then launches `GameScene`.
5. ✅ Confirm `PlayerController` moves the player with WASD/arrow keys, collision works, and entering a new chunk triggers lazy generation.
6. ✅ **Checkpoint**: After login the player sees a sprite-rendered world; walking around reveals new tiles; the champion sprite moves correctly; the Firebase console shows chunk data being written under `/map/`.

---

## Step 4 — HUD (HP / MP / Gold) ✅
*Goal: a persistent heads-up display shows the player's name, HP, MP, and gold.*

1. ✅ `HudScene` with HP, MP, and gold text is already implemented — verify it launches alongside `GameScene`.
2. ✅ Subscribe to `/players/{id}` via Firebase `onValue` so the HUD updates when values change remotely (e.g. future healer writes).
3. ✅ **Checkpoint**: HP, MP, and gold are visible at the top of the screen while exploring; changing a value directly in the Firebase console is reflected in the HUD within a second.

---

## Step 5 — Other Players (Multiplayer Presence) ✅
*Goal: two logged-in tabs can see each other's champion sprites moving in real time.*

1. ✅ `GameScene` declares `_remotePlayers: Map<string, { sprite, label }>` and `_presenceUnsub`.
2. ✅ `_subscribePresence(room)` — tears down previous `onValue` listener, clears all remote sprites, then subscribes to `/presence/{room}/players`. On each snapshot it creates/tweens/removes sprites and labels.
3. ✅ Called on startup (`create()`), on room enter (`_handleEnterRoom`) and on room exit (`_handleExitRoom`).
4. ✅ Listener is cleaned up in `SHUTDOWN` event.
5. ✅ **Checkpoint**: Open two browser tabs and log in as two different players; both see the other move in real time.

---

## Step 6 — Enemy & NPC Sprites ✅
*Goal: enemies and NPCs that belong to a chunk appear as sprites when the chunk loads.*

1. ✅ Subscribe to `/presence/{room}/enemies` and `/presence/{room}/npcs` with Firebase `onValue`.
2. ✅ Render each entity as a directional `Sprite` using the same 5-frame-per-direction walk logic as the player; update facing from movement delta, animate while moving, and keep idle frame 0 of the current direction.
3. ✅ No AI or interaction yet — display only.
4. ✅ **Checkpoint**: Walk into a chunk that contains enemies or NPCs; their sprites appear on screen.

---

## Step 7 — Proximity Chat ✅
*Goal: nearby players can exchange text messages in real time.*

1. ✅ Add a chat input box and scrollable message list to `HudScene` (DOM overlay, same pattern as `IntroScene`).
2. ✅ On send, write `{ sender, x, y, text, timestamp }` to `/chat/{room}`.
3. ✅ Subscribe to `/chat/{room}`; display only messages within ≤15 tiles; auto-prune entries older than 5 minutes.
4. ✅ System messages (level-up, etc.) use a distinct colour.
5. ✅ **Checkpoint**: Two players standing near each other can exchange chat messages; a player far away does not see the messages; messages disappear after 5 minutes.

---

## Step 8 — Player Attack & Enemy Death ✅
*Goal: the player can attack adjacent enemies, deal damage, and earn XP on kill.*

1. ✅ On the interact key (`A`) when the player is adjacent to an enemy, calculate damage and write the updated HP to `/presence/{room}/enemies/{id}`.
2. ✅ When HP reaches 0, write loot to Firebase and grant XP to the attacking player (`/players/{id}/xp`).
3. ✅ **Checkpoint**: Walk up to an enemy, press `A` repeatedly; enemy HP decreases and the sprite disappears on death; XP is added to the player record in Firebase.

---

## Step 9 — Enemy AI (Pyodide Scripting) ✅
*Goal: enemies patrol, chase the player, and attack autonomously.*

1. ✅ Integrate Pyodide WASM; load the Python runtime in `LoadingScene` as a progress step.
2. ✅ Implement `ScriptExecutor`: claim ownership of up to 4 nearby enemies by writing `executingPlayerId`; release on disconnect.
3. ✅ Each tick, run each owned enemy's `script` in the sandbox with `{ state, hp, x, y, nearbyPlayers }` and action callbacks (`move`, `attack`, `setState`, `speak`).
4. ✅ **Checkpoint**: Enemies patrol their area and chase + attack the player when in range; the player can still kill them with the attack from Step 8.

---

## Step 10 — NPC Interaction & Dialogue ✅
*Goal: the player can talk to NPCs and receive a tangible effect (healing, hints).*

1. ✅ On the interact key adjacent to an NPC, open a `DialogScene` DOM overlay showing the NPC portrait (frame 0) and speech text from its script.
2. ✅ Healer: write full HP/MP to `/players/{id}`; Gossiper: read `config/pois` for directional tips; Merchant: open `ShopScene` instead.
3. ✅ Dog NPC: spawns in villages (50% chance), follows the player when interacted with via `A`, loses interest after 5 minutes without re-interaction (`dog_follow.py`).
4. ✅ **Checkpoint**: Walk up to a healer with reduced HP and press `A`; HP is restored and the HUD updates.

---

## Step 11 — Inventory, Gathering & Crafting ✅
*Goal: the player can gather a resource, see it in their inventory, and craft a basic item.*

1. ✅ On interact with a gatherable tile (e.g. `tree_oak`), add the material to `player.inventory` in Firebase and replace the tile with its depleted variant + set `regenAt`.
2. ✅ `InventoryScene` DOM overlay: grid of item slots with equip/drop/use actions.
3. ✅ `CraftScene` DOM overlay: list recipes by station and level; craft button writes the result and consumes ingredients.
4. ✅ **Checkpoint**: Chop a tree → wood appears in inventory → craft a wooden sword at a workbench.

---

## Step 12 — House Interior Maps ✅
*Goal: every enterable village building opens an 8×8 interior room; the player can craft and store items inside.*

1. ✅ Walk up to (touch) any building tile (`house_hut`, `house_cabin`, `barracks`, `chapel`, `tavern`, `workshop`) — `PlayerController._checkTileTransition()` auto-emits `'enterRoom'` with the room ID `house_${tx.padStart(4,'0')}_${ty.padStart(4,'0')}` and spawn coordinates.
2. ✅ `GameScene` handles the event: calls `ChunkManager.enterRoom(roomId)` to load the room's tiles from Firebase, resets `TilemapRenderer`, teleports the player to `(spawnX, spawnY)`, and narrows camera bounds to `8×8` tiles.
3. ✅ The room is already generated and persisted when the village chunk was first loaded (`HouseGen.generateHouseRoom` → `ChunkManager._generateAndPersistChunk`). Each building receives a **seeded-random furniture layout** themed by type: residential buildings get a bed, a dining table with two flanking chairs, optional sofa, and chest; the player's own house additionally gets a workbench; taverns get multiple dining tables (each with two chairs), sofas, and a chest; workshops get workbenches, an optional forge, and a chest; barracks get a quest board, chests, and an optional briefing table with seating; chapels get a dungeon altar and chests. No two buildings of the same type at different positions look identical.
4. ✅ Stepping onto the `house_exit` tile auto-emits `'exitRoom'` → `ChunkManager.exitRoom()` → camera bounds restored to 1000×1000 → player returns to saved overworld tile. An 800 ms cooldown prevents immediate re-entry.
5. ✅ **Checkpoint**: Walk up to a house sprite; interior room appears automatically with `house_floor` tiles and themed furniture; stepping onto the portal returns the player to the village.

---

## Step 13 — Dungeon Navigation ✅
*Goal: the player can enter a dungeon and navigate between floors.*

1. ✅ Step onto a `dungeon_entrance` tile → `PlayerController._checkTileTransition()` auto-emits `'enterRoom'` with room ID `dungeon_${tx.padStart(4,'0')}_${ty.padStart(4,'0')}_floor_1`.
2. ✅ `GameScene` loads the dungeon floor from `/map/{room}` (same `enterRoom` path as houses), adjusts camera bounds to `40×40` tiles.
3. ✅ `dungeon_stairs_down` on floor N transitions to floor N+1; stepping onto `dungeon_stairs_up` returns to the overworld or previous floor.
4. ✅ Boss room: lock on aggro (`onDisconnect` release); chest drops gold/loot on interaction.
5. ✅ **Checkpoint**: Walk onto a dungeon entrance tile; the dungeon floor appears automatically; stairs lead deeper; stepping onto stairs_up returns to the overworld.

---

## Step 14 — Village Shop & Economy ✅
*Goal: the player can buy and sell items at a merchant.*

1. ✅ `ShopScene` DOM overlay: buy/sell tabs; stock filtered by player level; prices = `baseBuyPrice × zoneMult × jitter`.
2. ✅ Limited-stock items tracked in `/shops/{villageId}/limitedStock`; gold transferred via Firebase transaction.
3. ✅ **Checkpoint**: Open a merchant's shop, buy leather armor; gold is deducted; the item appears in inventory.

---

## Step 15 — Death & Respawn ✅
*Goal: when the player's HP reaches 0 they drop items and respawn at their house.*

1. ✅ HP = 0 → drop inventory as loot at current position → set `player.hp = maxHp * 0.5` → teleport to `player.house`.
2. ✅ `DeathScene` DOM overlay shows:
   - "YOU DIED" title with red glow
   - Killer name (enemy display name from `EnemyRegistry`)
   - Gold retained (never dropped)
   - Items lost (stack count)
   - 10-second auto-respawn countdown bar
   - "Respawn at House" button
3. ✅ After respawn, overworld chunks around the house are pre-loaded before unfreezing the player (prevents blank-world spawn).
4. ✅ After respawn, if items were dropped, a system chat message gives the compass direction and tile distance to the loot chest (handles overworld, house, dungeon floor N, and cellar rooms).
5. ✅ PVP: attack allowed only when both players are ≥ level 10 and in the same room. Facing a remote player with A reads their HP via Firebase, applies attacker's power as damage, writes the new HP back, and shows a float text. Below level 10 shows "PVP: level 10+ only" hint.
6. ✅ The loot location is persisted on the player record as `lastDeathLoot` ({room, x, y}), so it survives reloads. While `lastDeathLoot` is set and the player is in that room, a gold compass-arrow icon is pinned to the edge of the screen pointing toward the chest. It clears automatically when the player opens that chest or gets within 2 tiles.
7. ✅ **Checkpoint**: Take enough damage to die; items drop; the death screen shows with killer info and countdown; player respawns at house with half HP; a chat hint points toward the dropped loot and an on-screen arrow points toward it until retrieved.

---

## Step 16 — Mini-map ⬜ *(removed by design decision)*
*Skipped — mini-map was implemented and then removed. Not part of the current scope.*

---

## Step 17 — Mobile / Touch Support ✅
*Goal: the game is playable on a phone with a virtual joystick.*

1. ✅ `isMobileDevice()` exported from `src/input/VirtualInput.ts` — true when `window.innerWidth < 640`.
2. ✅ `virtualInput` module-level object (`up/down/left/right/action`) shared between HudScene (writer) and PlayerController (reader). PlayerController ORs virtual flags with keyboard; D-pad action button uses rising-edge detection to fire a single `playerAttack` event per press.
3. ✅ Virtual joystick rendered by `HudScene._buildDpad()`: circular base (bottom-left) with a draggable knob; pointer capture on the base so held movement survives drift; knob position translated to directional flags with 20% dead zone and 0.3 threshold for 8-directional input. Action (A) and Inventory (I) buttons remain in a right-side column.
4. ✅ Compact chat: `#chat-panel.mobile` CSS class applied on mobile — 150px wide, 44px max-height, 9px font.
5. ✅ Tap-to-interact in `GameScene`: on `pointerup`, if distance < 12 px (true tap) and the tapped tile is adjacent to the player, calls `_handleInteract` toward that tile. Skipped when any overlay scene is active.
6. ✅ **Checkpoint**: Narrow the browser to < 640 px; D-pad appears at bottom-right; all four directions and the A button work; tapping adjacent tiles/entities triggers interaction.

---

## Step 18 — Adaptive Ambience Music ✅
*Goal: background music adapts to situation and location with smooth transitions and no abrupt restarts.*

1. ✅ `MusicDirector` service (`src/audio/MusicDirector.ts`): manages three playlists (`world_ambient`, `world_action`, `dungeon_dark_ambient`) loaded from `public/assets/music/`; shuffle-bag per playlist; 2.5 s crossfade; 15 s dwell guard; volume/enabled persisted to localStorage; listens to `game.events` for live setting updates.
2. ✅ `LoadingScene.preload()` loads all 9 tracks (`music_ambient_1–3`, `music_action_1–3`, `music_dark_1–3`).
3. ✅ `GameScene` evaluates threat every 1 s: Chebyshev radius 12, weight 1 normal / 2 elite+boss / +1 if chasing; selects `world_action` at score ≥ 6, else `world_ambient`.
4. ✅ Entering a `dungeon_*` room forces `dungeon_dark_ambient` playlist (both `_handleEnterRoom` and `_restoreRoom`); exiting returns to `world_ambient` and threat re-evaluates on the next 1 s tick.
5. ✅ `HudScene._buildMusicPanel()` adds a ♪ button (top-right toolbar) that opens a settings panel with ON/OFF toggle and volume slider; emits `musicEnabled`/`musicVolume` game events consumed by `MusicDirector`.
6. ✅ **Checkpoint**: Overworld uses ambient tracks at low threat, swaps to action tracks during heavy combat, dungeons always use dark ambient, and all transitions are smooth.

---

## Step 19 — Tombstone Interaction & Skeleton Horde ✅
*Goal: interacting with a village tombstone spawns a wave of skeleton enemies around it.*

1. ✅ On the interact key (`A`) adjacent to a `tombstone` tile, `GameScene._handleInteract` spawns a configurable wave of `skeleton_weak` enemies at tile positions surrounding the tombstone and writes them to Firebase presence.
2. ✅ **Checkpoint**: Walk up to a village tombstone and press `A`; a group of skeletons appears around it and immediately engages the player.

---

## Step 20 — Ranged Bows & Elemental Magic ✅
*Goal: ranged and magic combat uses spawned projectiles with distinct elemental behaviour and shop/crafting integration.*

1. ✅ `ProjectileSystem` (`src/world/ProjectileSystem.ts`): spawns coloured arc projectiles per element (brown=physical, orange=fire, cyan=water, green=earth, white=air); moves along direction vector each frame; wall collision stops projectile; enemy tile-proximity collision fires `ProjectileHitEvent`; anti-double-hit `Set` per projectile; `destroyAll()` on room transition and scene shutdown.
2. ✅ Bow weapons fire physical projectiles with speed/range/cooldown stats: `wooden_bow` (140px/s, 7 tiles, 700ms cooldown), `iron_bow` (170px/s, 10 tiles, 600ms), `dark_bow` (200px/s, 12 tiles, 550ms, dungeon altar level 8).
3. ✅ Elemental magic weapons with distinct behaviour:
   - `air_wand` (level 2): fast (220px/s, ×1.5 at fire), wide range 9 tiles.
   - `fire_wand` (level 3): burn DOT — 2 delayed follow-up hits at 33% base damage at 1 s and 2 s.
   - `water_staff` (level 3): writes `slowEndAt` to enemy Firebase entries so AI scripts can reduce speed.
   - `earth_staff` (level 4): +30% upfront damage baked in at spawn (armor break).
   - `soul_staff` (level 10): high-power fire + extended burn DOT (dungeon altar).
4. ✅ MP cost and cooldown gates: magic cast checks `player.mp >= mpCostPerSwing`; deducts MP and writes to Firebase; shows "No MP!" float text on failure. `PlayerController` reads `weapon.cooldownMs` from `WeaponDefinition` for per-weapon timing.
5. ✅ `WeaponDefinition` extended with `projectileSpeed`, `projectileRange`, `element`, `statusEffect`, `cooldownMs`. All ranged/magic weapons in `weapons.ts` carry these metadata fields.
6. ✅ Shop integration: `air_wand`, `fire_wand`, `water_staff`, `earth_staff` sold in village shops (limited 5 stock for elemental weapons); `mana_crystal` and `sand_crystal` available as limited-stock shop items (3/day).
7. ✅ Crafting integration: workbench recipes for `air_wand` (wood + mana_crystal) and `water_staff` (sand_crystal + wood); workshop recipes for `fire_wand` (mana_crystal + iron_bar) and `earth_staff` (stone + iron_bar + mana_crystal); dungeon altar recipes for `dark_bow` (iron_bar + dark_crystal + leather) and `soul_staff` (ancient_wood + mana_crystal + ectoplasm). New elemental materials added to `items.ts`: `mana_crystal`, `sand_crystal`, `ectoplasm`, `dark_crystal`, `ancient_wood`.
8. ✅ Anti-double-hit via per-projectile `hitEnemyIds: Set<string>`; kill logic extracted to `_resolveEnemyKill()` shared by melee and projectile paths; `_handleProjectileHit()` applies elemental effects before resolving damage.
9. ✅ **Checkpoint**: Player can equip bow and shoot visible projectiles; cast fire/water/earth/air spells with MP consumption (No MP! on failure); buy basic ranged/magic gear and elemental materials from shops; craft elemental weapons at workbench/workshop/dungeon altar.

---

## Step 21 — Character Stats & Level-Up Growth ✅
*Goal: primary stats (STR/DEX/INT/VIT) meaningfully scale combat and utility as players level up.*

1. ✅ `PlayerInstance.stats` (already `{ strength, agility, intelligence, endurance }` — STR/DEX/INT/VIT) is now load-bearing and paired with a new `statPoints` field for unspent allocation. `endurance` (VIT) drives maxHp growth and defense baseline; `intelligence` (INT) drives maxMp growth and magic power; `agility` (DEX) drives ranged power and crit chance; `strength` (STR) drives melee power.
2. ✅ Derived combat formulas centralised in `src/world/playerStats.ts` (single source of truth — `deriveCombatStats`/`applyDerivedCombatStats`/`rollAttackDamage`):
   - meleePower = weaponPower + str * 2
   - rangedPower = weaponPower + dex * 1.8
   - magicPower = weaponPower + int * 2.2
   - defense = armorDefense + vit * 0.8
   - critChance = min(35%, 5% + dex * 0.25%) — rolled on every player/PVP attack; crits deal ×1.5 damage and show a `CRIT!` floating indicator.
   `player.power`/`totalDefense` are recomputed from gear + stats by `applyDerivedCombatStats` on registration (`Auth.ts`) and on every weapon/armor equip/unequip (`InventoryScene`), so combat code keeps reading the same fields it always has.
3. ✅ Level-up rewards (`GameScene` enemy-kill handler): 3 allocatable stat points per level, +1 bonus every 5th level, persisted as `players/{id}/statPoints`; maxHp grows from `endurance` and maxMp from `intelligence` each level instead of flat increments.
4. ✅ `LevelUpScene` stat allocation flow for STR/DEX/INT/VIT with a live preview of melee/ranged/magic power, defense, and crit chance before confirming (`deriveCombatStats` run against the pending allocation).
5. ✅ `LevelUpScene` DOM overlay (`src/scenes/LevelUpScene.ts`):
   - "✦ LEVEL UP! ✦" banner with the new level number,
   - STR/DEX/INT/VIT +/− allocation buttons with an unspent-points counter,
   - live preview panel showing current → projected melee/ranged/magic power, defense, and crit chance,
   - newly-unlocked weapons/armors/recipes at this level listed via `findNewUnlocks` (scans `WeaponRegistry`/`ArmorRegistry`/`RecipeRegistry` by `levelRequired`),
   - **Confirm** enabled only once every point is spent (writes `stats`/`statPoints`/`power`/`totalDefense` to Firebase); `Esc` closes and keeps points for later.
6. ➖ *Skipped* — rebalancing enemy scaling/Tier 3-4 gear stat requirements is a tuning pass better done once Step 20 (ranged/magic combat) lands; the new formulas already gate weapon/armor use by `levelRequired` as before.
7. ✅ Pressing **`S`** opens `StatsScene` (`src/scenes/StatsScene.ts`) — a full DOM overlay (same visual language as `LevelUpScene`/`PauseScene`) showing the player's name/level, STR/DEX/INT/VIT, derived melee/ranged/magic power, defense, and crit chance. If the player has unspent points it reuses the same +/− allocation + live-preview + Confirm flow as `LevelUpScene` (so banked points from a level-up the player skipped can still be spent later); a **Log Out** button (`Auth.logout`, same flow as `PauseScene`) is also available here. Replaces the earlier condensed "Σ" HUD toolbar panel, which has been removed (`GameScene._openStats`, registered in `PAUSE_BLOCKING_SCENES`/`main.ts`, key binding documented in `PauseScene`'s reference list). *(No temporary buff/debuff system exists yet, so nothing to highlight there.)*
8. ✅ **Checkpoint**: On level-up the `LevelUpScene` overlay appears; player allocates points with a live preview; after Confirm, combat output changes immediately (attack damage and incoming defense are derived from `power`/`totalDefense`, recomputed from STR/DEX/INT/VIT + gear) and the values persist correctly across relog (`players/{id}/stats`, `statPoints`, `power`, `totalDefense`).

---

## Step 22 — Gold-Stealing Enemies ✅
*Goal: thief and bandit enemy variants steal gold from the player on hit and permanently lose it if they escape.*

1. ✅ `carriedGold` is now populated at spawn from each enemy template's `gold_coin` loot entries (`rollEnemyInitialCarriedGold`) in overworld chunks, dungeons, and cellars.
2. ✅ Successful enemy hits now run gold-steal resolution in `GameScene`: subtract `min(stealAmount, player.gold)`, add to `entities/enemies/{id}/carriedGold`, and emit a system chat message (for example: *"Thief stole 12 gold from you!"*).
3. ✅ Profiles implemented: `thief_weak` steals once then is forced into `fleeing`; `bandit_strong`, `desert_bandit_strong`, and `goblin_scout_strong` can steal on repeated hits while fighting.
4. ✅ On enemy death, `carriedGold` is dropped as reclaimable chest gold at the death tile instead of being auto-added directly to the player's wallet.
5. ✅ If a fleeing thief reaches >30 tiles, tracked stolen gold is removed from `carriedGold` (lost permanently) and a system chat notice is posted.
6. ✅ **Checkpoint**: thieves/bandits now steal gold on hit with chat feedback; killing them drops reclaimed gold at the death tile; allowing fleeing thieves to escape beyond 30 tiles burns the stolen amount.

---

## Step 23 — Pause Screen ✅
*Goal: the player can pause, adjust settings, and log out cleanly.*

1. ✅ `PauseScene` DOM overlay: **Resume**, **Settings** (collapsible panel with music ON/OFF + volume slider mirroring `HudScene`'s music panel, plus a read-only key-binding reference list), **Log Out** buttons. Opens via `Esc` (when no other overlay owns input) or the new `☰` menu button in the HUD top-right toolbar (`GameScene._openPause`, `HudScene._buildMenuBtn` emitting `openPause`); freezes the player like other overlays and unfreezes on shutdown.
2. ✅ **Log Out** (`Auth.logout`) writes `players/{id}/online = false` + `lastSeen`, removes the `presence/{room}/players/{id}` entry, clears the local session, then `PauseScene` stops `GameScene`/`HudScene` and starts `LoginScene`.
3. ✅ **Checkpoint**: Press `Esc` or the menu button; the **PAUSED** overlay appears over the frozen game world; **Settings** reveals music controls and key bindings; **Resume** (button or `Esc`) returns to play; **Log Out** clears presence and navigates to the login screen.

---

## Step 24 — Quest Log, Player Counters & Category Progression ✅
*Goal: persistent per-category quests with automatic progression, a quest-log overlay, and lifetime counter tracking.*

1. ✅ Add `QuestCategory`, `QuestTemplate`, `QuestObjective`, `ActiveQuest` to `types.ts`; add `progressCounters` (12 counter fields incl. maps) and `quests` (`active` keyed by category, `completed` keyed by quest id) to `PlayerInstance`.
2. ✅ Create `src/data/quests.ts` — **33 quest templates** across 6 categories, ordered by difficulty. New players receive the first quest in every category automatically.
3. ✅ Create `src/world/questUtils.ts` — `checkAndAdvanceQuestsLocally()`:
   - Checks all active quests against current `progressCounters`.
   - Marks completed quests, applies reward XP + gold to the player in-place.
   - Advances each completed category to its next quest (by `order`), or removes the category slot if all quests are done.
   - Returns a ready-to-merge Firebase update map + list of completed quest titles for in-game notifications.
4. ✅ Create `src/scenes/QuestScene.ts` — DOM overlay (same pattern as `StatsScene`):
   - **Quests tab**: categories shown as expandable cards with current quest title, description, per-objective progress bar, and `done / total` category counter.
   - **Counters tab**: reads `players/{id}/progressCounters`; every key rendered with human-readable label; map sub-keys expand as sorted sub-lists.
   - `Q` / `Esc` shortcut + **Close** button.
5. ✅ Register `QuestScene` in `src/main.ts`; add to `PAUSE_BLOCKING_SCENES` in `GameScene`.
6. ✅ Wire `Q` key + `game.events.on('openQuests')` in `GameScene.create` → `_openQuests()`. Distance flushed on SHUTDOWN.
7. ✅ `checkAndAdvanceQuestsLocally` called after every counter write — `_resolveEnemyKill`, `_triggerDeath`, `_handleEnterRoom`, `_flushDistanceTraveled`, `_handleGather`.
8. ✅ Counter increments wired:
   - `enemiesKilledTotal` + `killsByEnemyId[baseType]` + `goldCollectedTotal` + `collectedByItemId[itemId]` — `_resolveEnemyKill`.
   - `collectedByItemId[itemId]` — `_handleGather` (chopping/mining tiles).
   - `deaths` — `_triggerDeath`.
   - `houseEntered` / `dungeonsVisited` — `_handleEnterRoom`.
   - `distanceTraveled` — per-tile accumulator, flushed every 30 s + on SHUTDOWN.
   - `craftsDone` + `craftedByItemId[itemId]` — `CraftScene._craft`.
   - `chatMessagesSent` — `HudScene._sendMessage`.
9. ✅ `HudScene`: `_buildQuestBtn()` adds `Q` toolbar button (left of ☰) and a `Q` button in the touch dpad column (tablet mode); `_subscribePlayer` merges `progressCounters` from Firebase.
10. ✅ Add `Q — Open quest log` to key-binding table in `PauseScene`.
11. ✅ **Checkpoint**: press `Q` or tap **Q** button (toolbar or touch dpad) → overlay with category cards (active quest + progress bars) and a Counters tab. Quest completion triggers float text and auto-advances to next quest in the same category, re-checking immediately so already-met follow-up quests complete in a chain. All counters written to Firebase and merged back on login.

## Step 25 — Quest System Rebalance (2-category model) ✅
*Goal: simplify quest categories, fix gathering tracking, and soften the XP curve.*

1. ✅ Reduced `QuestCategory` to two categories: **⚔ Combat** and **🪵 Gathering & Crafting**. Removed Exploration, Social, and Economy categories and their templates entirely.
2. ✅ Merged the old Gathering and Crafting template lists into a single 13-step `gathering` chain interleaving leather/wood/stone/iron-ore collection with workbench/forge craft counts.
3. ✅ Combat expanded to 13 steps with smoother goal progression (1→3→8→15→30→50→90→150 kills, plus flavor quests for wolves/crabs/bandits).
4. ✅ Both categories share the same softened-exponential reward curve (15, 20, 25, 30, 35, 45, 55, 70, 90, 110, 140, 175, 220 XP — roughly ×1.25 per step), reducing early rewards versus the previous scheme while keeping late-game milestones meaningful. Final quest of each category also grants 50 gold.
5. ✅ Fixed a bug where enemy-kill loot (e.g. leather from wolves/crabs) never incremented `collectedByItemId` — the diff-based detection compared `player.inventory` against itself after it had already been overwritten. Now loot quantities are tracked directly while rolling the loot table.
6. ✅ Fixed `checkAndAdvanceQuestsLocally` so that after auto-advancing to the next quest in a category, it immediately re-checks the new quest's objectives and keeps advancing until it finds one that isn't already met (handles bulk-progress / catch-up cases).
7. ✅ `QuestScene` category list/labels updated to the 2-category model.

> ⚠️ **Schema change** — existing players' `quests/active` and `quests/completed` data reference the old category names/quest ids (`explore_*`, `social_*`, `economy_*`, `craft_*`). Per project policy, reset/delete the affected player `quests` and `progressCounters` data (or the whole `players` test data) in Firebase Realtime Database before testing, rather than writing migration scripts.

---

## Step 26 — Player Vendors & Trading 🔲
*Goal: a player-driven economy — sell items from your house storage to other players, even while you're offline.*

1. 🔲 Add `vendor?: { listings: Record<string, { itemId: string; quantity: number; price: number }>; till: number }` to `PlayerInstance` in `types.ts`. `till` holds accumulated sale proceeds, kept separate from `gold` until the owner collects it.
2. 🔲 `HouseGen.ts`: add a `vendor_stall` furniture tile to the `player_house` layout (alongside `workbench` and the storage `chest`), placed via the existing seeded `place()` helper.
3. 🔲 Register the `vendor_stall` tile (sprite + `_CHEST_TILES`-style interaction set) so `E` on it opens a new `VendorScene`.
4. 🔲 `VendorScene` (DOM overlay, same pattern as `StorageScene`/`ShopScene`):
   - **Owner view** — if `tile` is in the local player's own house room: pick item + quantity from the storage chest inventory, set a price per unit, create/update a listing; remove a listing (returns unsold quantity to the chest); **Collect** button moves `till` into `gold`.
   - **Buyer view** — if visiting another player's house: list the owner's active listings (item, qty remaining, price); **Buy** button with a quantity stepper.
5. 🔲 Buy flow: `runTransaction` on `players/{ownerId}/vendor/listings/{listingId}` to decrement `quantity` atomically (delete the listing at 0, preventing oversell across concurrent buyers). On success, `update()`: buyer `gold -= price*qty`, buyer `inventory += item`, owner `vendor/till += price*qty`. Block buying your own stall, or with insufficient buyer gold/listing stock.
6. 🔲 GameScene: detect "is this the local player's own house room" via `roomId === houseRoomId(player.house.x, player.house.y)` (already used for the `houseEntered` counter) to branch `VendorScene` into owner vs. buyer mode.
7. 🔲 **Checkpoint**: Player A opens their vendor stall, lists 5 `wood` @ 3 gold each. Player B walks into A's house (A can be offline), opens the stall, buys 2 wood — B's gold drops by 6 and inventory gains 2 wood; A's listing now shows 3 remaining and `till = 6`. A later opens the stall and collects the 6 gold into their balance.

> ⚠️ **Schema change** — adds a new optional `vendor` field to `PlayerInstance` and a new `vendor_stall` tile to existing player houses. Per project policy, reset/regenerate affected house room data (`map/house_{tx}_{ty}`) in Firebase before testing.
