# RPIdigo — Implementation Plan (from Spec)

## Sprite note
All sprite sheets are 16×16-pixel grids. **Only the first grid cell (frame 0, top-left 16×16 pixels) is used** for every tile, enemy, NPC, and player sprite until animation is added in a later step. Phaser's `setFrame(0)` on a `frameWidth: 16, frameHeight: 16` spritesheet is the pattern to use throughout.

---

## Step 1 — Firebase Project Setup & Database Configuration
*Goal: app compiles, connects to Firebase, world seed is bootstrapped. No gameplay yet.*

1. Copy `.env.example` to `.env` and fill in real Firebase Realtime Database credentials (API key, auth domain, databaseURL, project ID, etc.).
2. Publish `database.rules.json` to the Firebase project (via Firebase CLI `firebase deploy --only database`). Rules cover all spec collections: `/config`, `/map`, `/players`, `/entities`, `/presence`, `/chat`, `/shops`.
3. Verify `firebase.ts` initialises `getDatabase(app)` — no changes needed, already correct.
4. Verify `WorldBootstrap.ensureWorldReady()` creates `config/seed` (transaction) and `config/pois` on first run, reads them on subsequent runs — already implemented.
5. Verify `registry/bootstrap.ts` loads all built-in definitions and merges `config/extensions` from Firebase — already implemented.
6. **Checkpoint**: `npm run build` passes; opening the game in a browser shows IntroScene; browser console shows no Firebase errors; Firebase console shows `config/seed` written after first "Play" click.

---

## Step 2 — Player Registration/Login, Sprite Rendering & World Exploration
*Goal: a player can register or log in, appear as their champion sprite on a rendered tile world, walk around, and trigger lazy chunk generation.*

### 2a — Preload assets in LoadingScene
- In `LoadingScene.preload()` (add `preload` lifecycle), call `this.load.spritesheet()` for every tile spritesheet referenced in the Spec (`Ground/Grass.png`, `Nature/Trees.png`, `Nature/PineTrees.png`, `Ground/Shore.png`, etc.) with `frameWidth: 16, frameHeight: 16`.
- Load all 8 champion spritesheets (`Characters/Champions/Arthax.png`, …) with the same frame size.
- Load the enemy and NPC spritesheets referenced in the spec, same frame size.
- Assets are served from `public/assets/sprites/` (already extracted).

### 2b — Upgrade TilemapRenderer to sprite-based rendering
- Replace the `Phaser.GameObjects.Graphics` approach with a **pool of `Phaser.GameObjects.Image`** objects (one per visible tile).
- Map each tile type to its spritesheet key + frame 0 (use a lookup table mirroring the SPEC tile table).
- On `drawViewport`, create/recycle Image objects positioned at `(tx * 16, ty * 16)`, set `setTexture(key).setFrame(0)`.
- Keep `invalidateTile` and `reset` working (destroy/repool images).
- `TILE_SIZE` stays `16`.

### 2c — Upgrade PlayerController to champion sprite
- Replace the `Phaser.GameObjects.Rectangle` sprite with a `Phaser.GameObjects.Image` using the player's `championId` spritesheet key and `setFrame(0)`.
- Size remains 16×16; depth 10.
- Camera follow, WASD/arrow movement, Firebase position sync, collision, and lazy chunk loading are all already implemented — no logic changes needed.

### 2d — Wire LoginScene champion preview images to real sprites
- The champion grid in `LoginScene` already shows `<img>` tags pointing to `/assets/sprites/entities/players/player_${c}.png` — these already exist in `public/assets/sprites/entities/players/`. No change needed.

### 2e — Verify full flow
- Register → `LoadingScene` seeds world, loads spawn-area chunks → `GameScene` renders tile sprites + player champion sprite.
- Player walks using WASD; entering a new chunk triggers `ensureRadius` → chunk generated and written to Firebase → tiles appear.
- **Checkpoint**: `npm run build` passes; player sees actual tile graphics (not coloured boxes); player sprite shows champion; moving causes world tiles to load in.

---

## Step 3 — Other Players (Multiplayer Presence)
- In `GameScene.create()`, subscribe to `/presence/{room}/players` with Firebase `onValue`.
- Render each remote player as a champion Image sprite at frame 0, with their name as a small Text above.
- On value change, update position with a short tween (smooth movement).
- Remove sprites on disconnect (entry deleted from presence).
- **Checkpoint**: two browser tabs, both logged-in players see each other move in real time.

---

## Step 4 — Enemy & NPC Sprites in the World
- Subscribe to `/presence/{room}/enemies` and `/presence/{room}/npcs`.
- Render each entity as an Image at frame 0 of its spritesheet key (registry lookup by `templateId`).
- Update positions on value change.
- No interaction or AI yet — display only.
- **Checkpoint**: enemies and NPCs appear in chunk as it loads; sprites visible.

---

## Step 5 — HUD (HP/MP Bars, Level, Gold, XP)
- In `HudScene`, build DOM overlay elements (HP bar, MP bar, level badge, XP bar, gold counter) using the existing DOM-overlay pattern from IntroScene/LoginScene.
- Read initial values from `getLocalPlayer()`.
- Subscribe to `/players/{id}` via Firebase `onValue` to keep HUD in sync when remote writes occur (e.g. healer heals).
- **Checkpoint**: HUD shows correct values; values update when player data changes in Firebase.

---

## Step 6 — Proximity Chat
- Add chat input + message list DOM elements to `HudScene`.
- On send, write to `/chat/{room}` with `{ sender, x, y, text, timestamp }`.
- Subscribe to `/chat/{room}`; filter messages by ≤15 tile distance from local player; display in chat list.
- Auto-prune messages older than 5 minutes (client-side filter + Firebase `remove()`).
- System messages (level-up, etc.) use a distinct colour.
- **Checkpoint**: two players can exchange nearby chat; messages vanish after 5 minutes.

---

## Step 7 — Enemy Combat & AI (Pyodide scripting)
- Integrate Pyodide WASM; load the Python runtime in `LoadingScene` as a progress step.
- Implement `ScriptExecutor`: claim ownership of enemies within range by writing `executingPlayerId` to `/entities/enemies/{id}`; release on disconnect.
- Each tick, run the entity's `script` string in the sandbox with `{ state, hp, x, y, nearbyPlayers }` + action callbacks (`move`, `attack`, `setState`, `speak`).
- Schedule in oldest-update-first order; cap at 4 enemies per slice.
- Player attack: on interact key adjacent to enemy → calculate damage → write HP to Firebase.
- On enemy death: write loot pickup to Firebase; grant XP to attacker.
- **Checkpoint**: enemies patrol, chase player, attack; player can kill them and gain XP.

---

## Step 8 — NPC Interaction & Dialogue
- On interact key adjacent to NPC, open `DialogScene` DOM overlay with NPC portrait (frame 0) and speech text from the NPC's script output.
- Healer: call `actions.heal(playerId, maxHp, maxMp)` → Firebase write.
- Gossiper: read `config/pois` to generate directional tips.
- Merchant: open `ShopScene` instead of dialogue.
- **Checkpoint**: walking up to a healer restores HP; gossiper gives dungeon/village hints.

---

## Step 9 — Inventory, Gathering & Crafting
- Gather: on interact with gatherable tile → add material to player inventory in Firebase; replace tile with depleted variant + set `regenAt` timestamp.
- `InventoryScene` DOM overlay: grid of item slots, equip/drop/use actions.
- `CraftScene` DOM overlay: filter recipes by station and player level; show ingredient have/need counts; craft button writes result item + consumes ingredients.
- **Checkpoint**: player chops a tree → wood in inventory → crafts wooden_sword at workbench.

---

## Step 10 — Dungeon System
- Step on `dungeon_entrance` tile → room transition: change `player.room` to `dungeon_{id}_1`, update presence.
- Render dungeon floor from `/map/{room}`.
- Stairs up/down transitions between floors.
- Boss room: lock on aggro (`onDisconnect` release).
- Dungeon chest gold/loot on interaction.
- **Checkpoint**: player enters dungeon, navigates floors, finds boss room.

---

## Step 11 — Village Shop & Economy
- `ShopScene`: buy/sell tabs; stock filtered by player level; prices = `baseBuyPrice × zoneMult × jitter`.
- Limited-stock items tracked in `/shops/{villageId}/limitedStock`.
- Gold transferred in Firebase transaction.
- **Checkpoint**: player buys leather armor from merchant; gold deducted; item appears in inventory.

---

## Step 12 — Death, Respawn & PVP
- HP reaches 0 → drop inventory items as loot at current position → set `player.hp = maxHp * 0.5` → teleport to house.
- `DeathScene` DOM overlay ("You have died. Respawning at your house…").
- PVP: attack allowed only when both players ≥ level 10 and in same room.
- **Checkpoint**: player dies to enemy; inventory dropped; respawns at house.

---

## Step 13 — Mini-map & Full Map Screen
- Mini-map in HUD (top-right, 64×64 canvas): render explored chunks as coloured dots; POI icons for visited villages/dungeons; player position dot.
- `MapScene` full-screen overlay: zoomed-out view of explored world with fog-of-war.
- **Checkpoint**: mini-map updates as player explores; full map accessible from HUD.

---

## Step 14 — Mobile / Touch Support
- Detect `window.innerWidth < 640`; render D-pad virtual joystick in `HudScene` using Phaser's pointer events.
- Compact HUD layout: chat collapses to ticker, mini-map shrinks to 64×64.
- Tap on adjacent tile/entity triggers interaction.
- **Checkpoint**: game playable on a phone with virtual joystick.

