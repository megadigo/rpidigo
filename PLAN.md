# RPIdigo — Implementation Plan (from Spec)

## Sprite note
All sprite sheets are 16×16-pixel grids. **Only the first grid cell (frame 0, top-left 16×16 pixels) is used** for every tile, enemy, NPC, and player sprite until animation is added in a later step. Phaser's `setFrame(0)` on a `frameWidth: 16, frameHeight: 16` spritesheet is the pattern to use throughout.

---

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
2. Confirm `register` writes the new player record under `/players/{id}` and presence under `/presence/0/players/{id}` in the Firebase console.
3. Confirm `login` finds the player by name, checks the password hash, and restores the session.
4. **Checkpoint**: Fill in the form, press **Register**; the loading screen appears; the Firebase console shows the new player entry. Press **Login** on a second visit; the same entry is reused.

---

## Step 3 — World Bootstrap & Colored-Tile Exploration
*Goal: after login the player drops into a playable world rendered with colored rectangles and can walk around.*

1. `WorldBootstrap.ensureWorldReady()`, `ChunkManager`, and `TilemapRenderer` (colored-rectangle version) are already implemented — verify the full flow.
2. Confirm `LoadingScene` seeds the world, pre-loads spawn-area chunks (radius 2), then launches `GameScene`.
3. Confirm `PlayerController` moves the player with WASD/arrow keys, collision works, and entering a new chunk triggers lazy generation.
4. **Checkpoint**: After login the player sees a colored-tile world; walking around reveals new tiles; the Firebase console shows chunk data being written under `/map/`.

---

## Step 4 — Tile Spritesheets
*Goal: replace colored rectangles with real tile graphics.*

1. Add a `preload()` method to `LoadingScene`; use `this.load.spritesheet()` to load every tile spritesheet from `public/assets/sprites/` (`Ground/Grass.png`, `Nature/Trees.png`, `Nature/PineTrees.png`, `Ground/Shore.png`, etc.) with `frameWidth: 16, frameHeight: 16`.
2. Rewrite `TilemapRenderer` to use a pool of `Phaser.GameObjects.Image` objects instead of `Phaser.GameObjects.Graphics`. Map each tile type to its spritesheet key + frame 0. Keep `invalidateTile` and `reset` working.
3. **Checkpoint**: The colored boxes are gone; the world renders real tile graphics (green grass, blue water, brown paths, etc.).

---

## Step 5 — Champion Sprite
*Goal: the player appears as their chosen champion instead of a white rectangle.*

1. In `LoadingScene.preload()`, also load all 8 champion spritesheets (`Characters/Champions/Arthax.png`, …) with `frameWidth: 16, frameHeight: 16`.
2. In `PlayerController.create()`, replace the `Phaser.GameObjects.Rectangle` with a `Phaser.GameObjects.Image` using `player.championId` as the texture key and `setFrame(0)`.
3. **Checkpoint**: The player sprite now shows the selected champion portrait; movement, camera-follow, and collision all still work.

---

## Step 6 — HUD (HP / MP / Gold)
*Goal: a persistent heads-up display shows the player's name, HP, MP, and gold.*

1. `HudScene` with HP, MP, and gold text is already implemented — verify it launches alongside `GameScene`.
2. Subscribe to `/players/{id}` via Firebase `onValue` so the HUD updates when values change remotely (e.g. future healer writes).
3. **Checkpoint**: HP, MP, and gold are visible at the top of the screen while exploring; changing a value directly in the Firebase console is reflected in the HUD within a second.

---

## Step 7 — Other Players (Multiplayer Presence)
*Goal: two logged-in tabs can see each other's champion sprites moving in real time.*

1. In `GameScene.create()`, subscribe to `/presence/{room}/players` with Firebase `onValue`.
2. For each remote entry, render a champion `Image` sprite at frame 0 with a small name `Text` above it.
3. On value change, update the position with a short tween for smooth movement; remove the sprite when the entry is deleted.
4. **Checkpoint**: Open two browser tabs and log in as two different players; both see the other move in real time.

---

## Step 8 — Enemy & NPC Sprites
*Goal: enemies and NPCs that belong to a chunk appear as sprites when the chunk loads.*

1. Subscribe to `/presence/{room}/enemies` and `/presence/{room}/npcs` with Firebase `onValue`.
2. Render each entity as an `Image` at frame 0 of its spritesheet key (look up by `templateId` in the registry). Update positions on value change; remove on deletion.
3. No AI or interaction yet — display only.
4. **Checkpoint**: Walk into a chunk that contains enemies or NPCs; their sprites appear on screen.

---

## Step 9 — Proximity Chat
*Goal: nearby players can exchange text messages in real time.*

1. Add a chat input box and scrollable message list to `HudScene` (DOM overlay, same pattern as `IntroScene`).
2. On send, write `{ sender, x, y, text, timestamp }` to `/chat/{room}`.
3. Subscribe to `/chat/{room}`; display only messages within ≤15 tiles; auto-prune entries older than 5 minutes.
4. System messages (level-up, etc.) use a distinct colour.
5. **Checkpoint**: Two players standing near each other can exchange chat messages; a player far away does not see the messages; messages disappear after 5 minutes.

---

## Step 10 — Player Attack & Enemy Death
*Goal: the player can attack adjacent enemies, deal damage, and earn XP on kill.*

1. On the interact key (e.g. `E`) when the player is adjacent to an enemy, calculate damage and write the updated HP to `/presence/{room}/enemies/{id}`.
2. When HP reaches 0, write loot to Firebase and grant XP to the attacking player (`/players/{id}/xp`).
3. **Checkpoint**: Walk up to an enemy, press `E` repeatedly; enemy HP decreases and the sprite disappears on death; XP is added to the player record in Firebase.

---

## Step 11 — Enemy AI (Pyodide Scripting)
*Goal: enemies patrol, chase the player, and attack autonomously.*

1. Integrate Pyodide WASM; load the Python runtime in `LoadingScene` as a progress step.
2. Implement `ScriptExecutor`: claim ownership of up to 4 nearby enemies by writing `executingPlayerId`; release on disconnect.
3. Each tick, run each owned enemy's `script` in the sandbox with `{ state, hp, x, y, nearbyPlayers }` and action callbacks (`move`, `attack`, `setState`, `speak`).
4. **Checkpoint**: Enemies patrol their area and chase + attack the player when in range; the player can still kill them with the attack from Step 10.

---

## Step 12 — NPC Interaction & Dialogue
*Goal: the player can talk to NPCs and receive a tangible effect (healing, hints).*

1. On the interact key adjacent to an NPC, open a `DialogScene` DOM overlay showing the NPC portrait (frame 0) and speech text from its script.
2. Healer: write full HP/MP to `/players/{id}`; Gossiper: read `config/pois` for directional tips; Merchant: open `ShopScene` instead.
3. **Checkpoint**: Walk up to a healer with reduced HP and press `E`; HP is restored and the HUD updates.

---

## Step 13 — Inventory, Gathering & Crafting
*Goal: the player can gather a resource, see it in their inventory, and craft a basic item.*

1. On interact with a gatherable tile (e.g. `tree_oak`), add the material to `player.inventory` in Firebase and replace the tile with its depleted variant + set `regenAt`.
2. `InventoryScene` DOM overlay: grid of item slots with equip/drop/use actions.
3. `CraftScene` DOM overlay: list recipes by station and level; craft button writes the result and consumes ingredients.
4. **Checkpoint**: Chop a tree → wood appears in inventory → craft a wooden sword at a workbench.

---

## Step 14 — Dungeon Navigation
*Goal: the player can enter a dungeon and navigate between floors.*

1. Step on a `dungeon_entrance` tile → set `player.room` to `dungeon_{id}_1` and update presence.
2. Render the dungeon floor from `/map/{room}`; stairs-down/up tiles trigger floor transitions.
3. Boss room: lock on aggro (`onDisconnect` release); chest drops gold/loot on interaction.
4. **Checkpoint**: Walk into a dungeon entrance; the screen transitions; stairs lead to deeper floors; a chest can be opened for loot.

---

## Step 15 — Village Shop & Economy
*Goal: the player can buy and sell items at a merchant.*

1. `ShopScene` DOM overlay: buy/sell tabs; stock filtered by player level; prices = `baseBuyPrice × zoneMult × jitter`.
2. Limited-stock items tracked in `/shops/{villageId}/limitedStock`; gold transferred via Firebase transaction.
3. **Checkpoint**: Open a merchant's shop, buy leather armor; gold is deducted; the item appears in inventory.

---

## Step 16 — Death & Respawn
*Goal: when the player's HP reaches 0 they drop items and respawn at their house.*

1. HP = 0 → drop inventory as loot at current position → set `player.hp = maxHp * 0.5` → teleport to `player.house`.
2. `DeathScene` DOM overlay shows "You have died. Respawning at your house…".
3. PVP: attack allowed only when both players are ≥ level 10 and in the same room.
4. **Checkpoint**: Take enough damage to die; items drop; the death screen shows; player respawns at house with half HP.

---

## Step 17 — Mini-map
*Goal: a small map in the HUD shows explored terrain and the player's position.*

1. Add a 64×64 canvas to `HudScene` (top-right corner); render explored chunks as coloured dots and POI icons for visited villages/dungeons.
2. `MapScene` full-screen overlay: zoomed-out explored world with fog-of-war, accessible from the HUD.
3. **Checkpoint**: Mini-map updates as the player walks into new chunks; opening the full map shows all explored areas.

---

## Step 18 — Mobile / Touch Support
*Goal: the game is playable on a phone with a virtual joystick.*

1. Detect `window.innerWidth < 640`; render a D-pad virtual joystick in `HudScene` using Phaser pointer events.
2. Compact HUD: chat collapses to a ticker, mini-map shrinks to 64×64.
3. Tapping an adjacent tile or entity triggers interaction.
4. **Checkpoint**: Load the game on a phone (or in a narrow browser window); the virtual joystick appears and the player can move and interact without a keyboard.

