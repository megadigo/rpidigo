# Claude Instructions

## Firebase Map Reset Requirement

After any change that requiment the database schema to change you must tell the user to delete/reset Firebase map data before testing, instead creating scripts to recover old version.

Reason: existing generated map tiles in Firebase may still reference old tile IDs or fields and can cause mismatches with current code/data.

Expected instruction to user:
- Delete or reset the `map` data in Firebase Realtime Database.
- Regenerate map content by loading the game again.


## Redone SPEC and PLAN

On every prompt review PLAN ans SPEC and update it with the new funcionality.

## Game Mechanics Overview

Quick index of major systems and their key files — use this to orient before diving into code.

1. **Quests** — Two categories (combat / gathering & crafting), shared reward curve, auto-advance chains via progress counters.
   `data/quests.ts`, `world/questUtils.ts`, `scenes/QuestScene.ts`

2. **Crafting** — Stations: workbench, workshop, dungeon_altar. Recipes gated by level; consumes ingredients, writes inventory to Firebase, feeds `craftsDone` quest counter.
   `data/recipes.ts`, `scenes/CraftScene.ts`

3. **Combat** — Melee/ranged/magic weapons, DEX-based crits, armor+VIT defense, elemental projectiles (fire/water/earth/air) with status effects (burn/slow/stagger/chain). A-key adjacent attack.
   `world/playerStats.ts`, `world/ProjectileSystem.ts`, `scenes/GameScene.ts`

4. **Enemies & Loot** — 15+ templates (species/variant), 6 behavior scripts (patrol_only/chase/flee/pack/aggressive/persistent), per-enemy loot tables, special abilities (poison, gold-theft).
   `data/enemies.ts`, `scripts/enemies/*.py`

5. **Dungeons** — Procedural BSP multi-floor dungeons at POI sites, seeded; rooms `dungeon_{tx}_{ty}_floor_{n}`; enemies, chests, dungeon_altar station per floor.
   `world/DungeonGen.ts`, `world/ChunkManager.ts`

6. **Cellars** — Small 20×20 single-room rat dens attached to ~7% of houses; room `cellar_{tx}_{ty}`; optional chest, 8-13 destructible cellar_barrel/cellar_box containers (occasional gold/material/potion drops), 2-4 aggressive rats using `patrol_chase`.
   `world/CellarGen.ts`

7. **Player House** — Unique 8×8 interior per player (deterministic from world coords); workbench, bed, dining table flanked by chair_left/chair_right, personal storage chest, themed furniture (optional forge in workshops), optional cellar.
   `world/HouseGen.ts`, `scenes/StorageScene.ts`

8. **Villages/NPCs** — Procedural villages (well, market stall, quest board, 4 building-lined arms); NPC templates (villager/hunter/merchant/healer/dog) with role dialog.
   `world/VillageGen.ts`, `scripts/npcs/*.py`, `scenes/DialogScene.ts`

9. **Inventory/Equipment** — Stackable materials/consumables, non-stackable weapons/armor, equip slots (weapon + 5 armor slots), registries for lookups.
   `data/items.ts`, `data/weapons.ts`, `data/armors.ts`, `scenes/InventoryScene.ts`

10. **Stats/Leveling** — STR/DEX/INT/VIT with unspent points on level-up; derived combat stats from gear+stats; level-ups unlock recipes/gear; `xpForLevel()` softened exponential.
    `world/playerStats.ts`, `world/types.ts`, `scenes/LevelUpScene.ts`

11. **World/Movement** — 1000×1000 tile overworld in 32×32 chunks (noise biomes, POIs); separate rooms for houses/cellars/dungeons; tile gathering (chop/mine/cut/pick) on E; collision-based movement.
    `world/ChunkManager.ts`, `world/ChunkGen.ts`, `world/CollisionMap.ts`, `renderer/TilemapRenderer.ts`

12. **Multiplayer/Firebase** — Presence at `/presence/{room}/{type}/{id}`, chat at `/chat/{room}`, gold-theft/damage transactions, all state synced via Realtime Database.
    `firebase.ts`, `scenes/GameScene.ts`, `player/Auth.ts`

