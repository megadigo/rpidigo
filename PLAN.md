# RPIdigo — Implementation Plan (from Spec)

> **Global sprite convention**: All sprite sheets are 16×16-pixel grids. **Only frame 0 (top-left 16×16 px) is used** everywhere until animation is added.
> - In Phaser: `this.load.spritesheet(key, path, { frameWidth: 16, frameHeight: 16 })` + `setFrame(0)`.
> - In DOM UI (login screen): `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)` on a `<canvas>`.
> This applies to every tile, champion, enemy, and NPC sprite.

## Step 1 — Firebase Setup & Title Screen
*Goal: app starts, title screen is visible, Firebase connects without errors.*

1. Copy `.env.example` to `.env` and fill in real Firebase Realtime Database credentials (API key, auth domain, databaseURL, project ID, etc.).
2. **Copy sprites into the public directory** so Vite includes them in the production build and amen.pt can serve them:
   ```
   cp -r graphics/MiniWorldSprites/MiniWorldSprites/Ground      public/assets/sprites/Ground
   cp -r graphics/MiniWorldSprites/MiniWorldSprites/Nature      public/assets/sprites/Nature
   cp -r graphics/MiniWorldSprites/MiniWorldSprites/Buildings   public/assets/sprites/Buildings
   cp -r graphics/MiniWorldSprites/MiniWorldSprites/Miscellaneous public/assets/sprites/Miscellaneous
   cp -r graphics/MiniWorldSprites/MiniWorldSprites/Characters  public/assets/sprites/Characters
   ```
   All in-game tile, building, champion, and miscellaneous sprites must live under `public/assets/sprites/` so that `dist/assets/sprites/` is populated after `npm run build`. The entity sprites (`entities/enemies/`, `entities/npcs/`, `entities/players/`) are already in `public/assets/sprites/` and do not need to be copied. These sprites have already been committed to the repository and this step only applies when setting up a fresh clone.
3. Publish `database.rules.json` via `firebase deploy --only database`. Rules cover `/config`, `/map`, `/players`, `/entities`, `/presence`, `/chat`, `/shops`.
4. `firebase.ts` and `registry/bootstrap.ts` are already correct — no changes needed.
5. **Checkpoint**: `npm run dev` opens the browser; the "rpidigo" title screen appears; clicking **Play** navigates to the login screen; browser console shows no Firebase errors.

---

## Step 2 — Player Registration & Login
*Goal: a new player can register with a name, password, and champion choice; an existing player can log back in.*

1. The `LoginScene`, `Auth.register`, and `Auth.login` are already implemented — verify they work end-to-end.
2. In the character-selection grid, each champion portrait is rendered via `<canvas>` using `ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)` — showing only frame 0 of the entity sprite sheet, scaled 2× to 32×32.
3. Confirm `register` writes the new player record under `/players/{id}` and presence under `/presence/0/players/{id}` in the Firebase console.
4. Confirm `login` finds the player by name, checks the password hash, and restores the session.
5. **Checkpoint**: Fill in the form, press **Register**; the loading screen appears; the Firebase console shows the new player entry. Press **Login** on a second visit; the same entry is reused.

---

## Step 3 — World Bootstrap & Sprite Exploration
*Goal: after login the player drops into a playable world rendered with real tile sprites and their chosen champion sprite, and can walk around.*

1. `LoadingScene.preload()` loads all tile spritesheets and all 8 champion spritesheets with `frameWidth: 16, frameHeight: 16`.
2. `TilemapRenderer` uses a pool of `Phaser.GameObjects.Image` objects; each tile type maps to its spritesheet key, displayed at frame 0.
3. `PlayerController` renders the player as a `Phaser.GameObjects.Image` with `player.championId` as the texture key and `setFrame(0)`.
4. Confirm `LoadingScene` seeds the world, pre-loads spawn-area chunks (radius 2), then launches `GameScene`.
5. Confirm `PlayerController` moves the player with WASD/arrow keys, collision works, and entering a new chunk triggers lazy generation.
6. **Checkpoint**: After login the player sees a sprite-rendered world; walking around reveals new tiles; the champion sprite moves correctly; the Firebase console shows chunk data being written under `/map/`.

---

## Step 4 — HUD (HP / MP / Gold)
*Goal: a persistent heads-up display shows the player's name, HP, MP, and gold.*

1. `HudScene` with HP, MP, and gold text is already implemented — verify it launches alongside `GameScene`.
2. Subscribe to `/players/{id}` via Firebase `onValue` so the HUD updates when values change remotely (e.g. future healer writes).
3. **Checkpoint**: HP, MP, and gold are visible at the top of the screen while exploring; changing a value directly in the Firebase console is reflected in the HUD within a second.

---

## Step 5 — Other Players (Multiplayer Presence)
*Goal: two logged-in tabs can see each other’s champion sprites moving in real time.*

1. In `GameScene.create()`, subscribe to `/presence/{room}/players` with Firebase `onValue`.
2. For each remote entry, render a champion `Image` sprite at frame 0 with a small name `Text` above it.
3. On value change, update the position with a short tween for smooth movement; remove the sprite when the entry is deleted.
4. **Checkpoint**: Open two browser tabs and log in as two different players; both see the other move in real time.

---

## Step 6 — Enemy & NPC Sprites
*Goal: enemies and NPCs that belong to a chunk appear as sprites when the chunk loads.*

1. Subscribe to `/presence/{room}/enemies` and `/presence/{room}/npcs` with Firebase `onValue`.
2. Render each entity as an `Image` at frame 0 of its spritesheet key (look up by `templateId` in the registry). Update positions on value change; remove on deletion.
3. No AI or interaction yet — display only.
4. **Checkpoint**: Walk into a chunk that contains enemies or NPCs; their sprites appear on screen.

---

## Step 7 — Proximity Chat
*Goal: nearby players can exchange text messages in real time.*

1. Add a chat input box and scrollable message list to `HudScene` (DOM overlay, same pattern as `IntroScene`).
2. On send, write `{ sender, x, y, text, timestamp }` to `/chat/{room}`.
3. Subscribe to `/chat/{room}`; display only messages within ≤15 tiles; auto-prune entries older than 5 minutes.
4. System messages (level-up, etc.) use a distinct colour.
5. **Checkpoint**: Two players standing near each other can exchange chat messages; a player far away does not see the messages; messages disappear after 5 minutes.

---

## Step 8 — Player Attack & Enemy Death
*Goal: the player can attack adjacent enemies, deal damage, and earn XP on kill.*

1. On the interact key (e.g. `E`) when the player is adjacent to an enemy, calculate damage and write the updated HP to `/presence/{room}/enemies/{id}`.
2. When HP reaches 0, write loot to Firebase and grant XP to the attacking player (`/players/{id}/xp`).
3. **Checkpoint**: Walk up to an enemy, press `E` repeatedly; enemy HP decreases and the sprite disappears on death; XP is added to the player record in Firebase.

---

## Step 9 — Enemy AI (Pyodide Scripting)
*Goal: enemies patrol, chase the player, and attack autonomously.*

1. Integrate Pyodide WASM; load the Python runtime in `LoadingScene` as a progress step.
2. Implement `ScriptExecutor`: claim ownership of up to 4 nearby enemies by writing `executingPlayerId`; release on disconnect.
3. Each tick, run each owned enemy’s `script` in the sandbox with `{ state, hp, x, y, nearbyPlayers }` and action callbacks (`move`, `attack`, `setState`, `speak`).
4. **Checkpoint**: Enemies patrol their area and chase + attack the player when in range; the player can still kill them with the attack from Step 8.

---

## Step 10 — NPC Interaction & Dialogue
*Goal: the player can talk to NPCs and receive a tangible effect (healing, hints).*

1. On the interact key adjacent to an NPC, open a `DialogScene` DOM overlay showing the NPC portrait (frame 0) and speech text from its script.
2. Healer: write full HP/MP to `/players/{id}`; Gossiper: read `config/pois` for directional tips; Merchant: open `ShopScene` instead.
3. **Checkpoint**: Walk up to a healer with reduced HP and press `E`; HP is restored and the HUD updates.

---

## Step 11 — Inventory, Gathering & Crafting
*Goal: the player can gather a resource, see it in their inventory, and craft a basic item.*

1. On interact with a gatherable tile (e.g. `tree_oak`), add the material to `player.inventory` in Firebase and replace the tile with its depleted variant + set `regenAt`.
2. `InventoryScene` DOM overlay: grid of item slots with equip/drop/use actions.
3. `CraftScene` DOM overlay: list recipes by station and level; craft button writes the result and consumes ingredients.
4. **Checkpoint**: Chop a tree → wood appears in inventory → craft a wooden sword at a workbench.

---

## Step 12 — House Interior Maps
*Goal: every enterable village building opens a 12×12 interior room; the player can craft and store items inside.*

1. Press **E** adjacent to any building tile (`house_hut`, `house_cabin`, `barracks`, `chapel`, `tavern`, `workshop`) — `PlayerController._handleInteract()` emits `'enterRoom'` with the room ID `house_${tx.padStart(4,'0')}_${ty.padStart(4,'0')}` and spawn coordinates.
2. `GameScene` handles the event: calls `ChunkManager.enterRoom(roomId)` to load the room's tiles from Firebase, resets `TilemapRenderer`, teleports the player to `(spawnX, spawnY)`, and narrows camera bounds to `12×12` tiles.
3. The room is already generated and persisted when the village chunk was first loaded (`HouseGen.generateHouseRoom` → `ChunkManager._generateAndPersistChunk`). Each building receives a **seeded-random furniture layout** themed by type: residential buildings get a bed, optional table/sofa, and chest; taverns get tables, sofas, and a chest; workshops get workbenches and a chest; barracks get a quest board and chests; chapels get a dungeon altar and chests. No two buildings of the same type at different positions look identical.
4. The `house_exit` tile in the room is adjacent-interactable: press **E** → `'exitRoom'` event → `ChunkManager.exitRoom()` → camera bounds restored to 1000×1000 → player returns to saved overworld tile.
5. **Checkpoint**: Walk up to a house sprite, press **E**; interior room appears with `house_floor` tiles and themed furniture; pressing **E** near the portal returns the player to the village.

---

## Step 13 — Dungeon Navigation
*Goal: the player can enter a dungeon and navigate between floors.*

1. Press **E** adjacent to a `dungeon_entrance` tile → `PlayerController._handleInteract()` emits `'enterRoom'` with room ID `dungeon_${tx.padStart(4,'0')}_${ty.padStart(4,'0')}_floor_1`.
2. `GameScene` loads the dungeon floor from `/map/{room}` (same `enterRoom` path as houses), adjusts camera bounds to `40×40` tiles.
3. `dungeon_stairs_down` on floor N transitions to floor N+1; `dungeon_stairs_up` / `house_exit` returns to overworld or the previous floor.
4. Boss room: lock on aggro (`onDisconnect` release); chest drops gold/loot on interaction.
5. **Checkpoint**: Walk up to a dungeon entrance, press **E**; the dungeon floor appears; stairs lead deeper; pressing **E** near stairs_up returns to the overworld.

---

## Step 14 — Village Shop & Economy
*Goal: the player can buy and sell items at a merchant.*

1. `ShopScene` DOM overlay: buy/sell tabs; stock filtered by player level; prices = `baseBuyPrice × zoneMult × jitter`.
2. Limited-stock items tracked in `/shops/{villageId}/limitedStock`; gold transferred via Firebase transaction.
3. **Checkpoint**: Open a merchant's shop, buy leather armor; gold is deducted; the item appears in inventory.

---

## Step 15 — Death & Respawn
*Goal: when the player's HP reaches 0 they drop items and respawn at their house.*

1. HP = 0 → drop inventory as loot at current position → set `player.hp = maxHp * 0.5` → teleport to `player.house`.
2. `DeathScene` DOM overlay shows "You have died. Respawning at your house…".
3. PVP: attack allowed only when both players are ≥ level 10 and in the same room.
4. **Checkpoint**: Take enough damage to die; items drop; the death screen shows; player respawns at house with half HP.

---

## Step 15 — Mini-map
*Goal: a small map in the HUD shows explored terrain and the player's position.*

1. Add a 64×64 canvas to `HudScene` (top-right corner); render explored chunks as coloured dots and POI icons for visited villages/dungeons.
2. `MapScene` full-screen overlay: zoomed-out explored world with fog-of-war, accessible from the HUD.
3. **Checkpoint**: Mini-map updates as the player walks into new chunks; opening the full map shows all explored areas.

---

## Step 16 — Mobile / Touch Support
*Goal: the game is playable on a phone with a virtual joystick.*

1. Detect `window.innerWidth < 640`; render a D-pad virtual joystick in `HudScene` using Phaser pointer events.
2. Compact HUD: chat collapses to a ticker, mini-map shrinks to 64×64.
3. Tapping an adjacent tile or entity triggers interaction.
4. **Checkpoint**: Load the game on a phone (or in a narrow browser window); the virtual joystick appears and the player can move and interact without a keyboard.

