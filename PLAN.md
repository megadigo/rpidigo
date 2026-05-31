# RPIdigo — Implementation Plan (from Spec)

> **Global sprite convention**: All sprite sheets are 16×16-pixel grids.
> - In Phaser: `this.load.spritesheet(key, path, { frameWidth: 16, frameHeight: 16 })`.
> - Tiles use frame 0.
> - Players, enemies, and NPCs use directional walk animation (5 frames per direction: down/up/right/left) and face movement direction.
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
   ├── Weapons/        weapon icons (16×16)
   ├── Armors/         armor icons (16×16)
   ├── Tools/          tool icons (16×16)
   ├── Dungeon/        dungeon buildings, floor, stairs, props (16×16)
   ├── House/          village buildings, house interior, furniture (16×16)
   └── Cellars/        cellar floor, walls, stairs, props (16×16)
   ```
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
4. ✅ **Checkpoint**: Walk up to a healer with reduced HP and press `E`; HP is restored and the HUD updates.

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
3. ✅ The room is already generated and persisted when the village chunk was first loaded (`HouseGen.generateHouseRoom` → `ChunkManager._generateAndPersistChunk`). Each building receives a **seeded-random furniture layout** themed by type: residential buildings get a bed, optional table/sofa, and chest; taverns get tables, sofas, and a chest; workshops get workbenches and a chest; barracks get a quest board and chests; chapels get a dungeon altar and chests. No two buildings of the same type at different positions look identical.
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
5. ✅ PVP: attack allowed only when both players are ≥ level 10 and in the same room. Facing a remote player with E reads their HP via Firebase, applies attacker's power as damage, writes the new HP back, and shows a float text. Below level 10 shows "PVP: level 10+ only" hint.
6. ✅ **Checkpoint**: Take enough damage to die; items drop; the death screen shows with killer info and countdown; player respawns at house with half HP; a chat hint points toward the dropped loot.

---

## Step 16 — Mini-map ⬜ *(removed by design decision)*
*Skipped — mini-map was implemented and then removed. Not part of the current scope.*

---

## Step 17 — Mobile / Touch Support ✅
*Goal: the game is playable on a phone with a virtual joystick.*

1. ✅ `isMobileDevice()` exported from `src/input/VirtualInput.ts` — true when `window.innerWidth < 640`.
2. ✅ `virtualInput` module-level object (`up/down/left/right/action`) shared between HudScene (writer) and PlayerController (reader). PlayerController ORs virtual flags with keyboard; D-pad action button uses rising-edge detection to fire a single `playerAttack` event per press.
3. ✅ D-pad rendered by `HudScene._buildDpad()` when mobile: 3×3 CSS grid of 44×44 buttons (bottom-right), pointer capture per button so held movement survives slight finger drift. Centre button = **E** (interact/attack).
4. ✅ Compact chat: `#chat-panel.mobile` CSS class applied on mobile — 150px wide, 44px max-height, 9px font.
5. ✅ Tap-to-interact in `GameScene`: on `pointerup`, if distance < 12 px (true tap) and the tapped tile is adjacent to the player, calls `_handleInteract` toward that tile. Skipped when any overlay scene is active.
6. ✅ **Checkpoint**: Narrow the browser to < 640 px; D-pad appears at bottom-right; all four directions and the E button work; tapping adjacent tiles/entities triggers interaction.
