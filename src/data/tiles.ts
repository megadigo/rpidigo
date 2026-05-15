import type { TileDefinition } from '../registry/types'

export const tiles: TileDefinition[] = [
  // ── Plains ───────────────────────────────────────────────────────────────
  { id: 'grass',         passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  { id: 'grass_tall',    passable: true,  speedMod: 0.6, destructible: false, spriteFrame: 'Ground/GrassTall.png' },
  { id: 'flower_yellow', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/GrassFlowerYellow.png' },
  { id: 'flower_red',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/GrassFlowerRed.png' },
  { id: 'dirt_path',     passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'Ground/GrassDead.png' },
  { id: 'rock_small',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Nature/RockSmall.png' },
  {
    id: 'rock_large', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 2, max: 4, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    becomesOnGather: 'grass', regenSeconds: 120,
    spriteFrame: 'Nature/RocksBig.png',
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  { id: 'grass_dark', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'Ground/GrassTall.png' },
  {
    id: 'tree_oak', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'chop',
    dropTable: [{ itemId: 'wood', min: 2, max: 5, chance: 1 }],
    becomesOnGather: 'stump', regenSeconds: 180,
    spriteFrame: 'Nature/Trees.png',
  },
  {
    id: 'tree_pine', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'chop',
    dropTable: [{ itemId: 'wood', min: 2, max: 4, chance: 1 }],
    becomesOnGather: 'stump', regenSeconds: 180,
    spriteFrame: 'Nature/PineTrees.png',
  },
  { id: 'coconut_tree', passable: false, speedMod: 0, destructible: false, spriteFrame: 'Nature/CoconutTrees.png' },
  {
    id: 'bush', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 3, chance: 1 }],
    becomesOnGather: 'grass', regenSeconds: 60,
    spriteFrame: 'Nature/Trees.png',
  },
  {
    id: 'mushroom', passable: true, speedMod: 1.0, destructible: true,
    gatherAction: 'pick',
    dropTable: [{ itemId: 'mushroom_item', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'grass_dark', regenSeconds: 90,
    spriteFrame: 'Ground/GrassTall.png',
  },
  { id: 'log',       passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Nature/Stump.png' },
  { id: 'moss_rock', passable: false, speedMod: 0,   destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 1, max: 3, chance: 1 }],
    becomesOnGather: 'grass_dark', regenSeconds: 120,
    spriteFrame: 'Nature/RockMoss.png',
  },
  { id: 'stump', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'Nature/Stump.png' },

  // ── River / Water ─────────────────────────────────────────────────────────
  { id: 'water_shallow', passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/WaterShallow.png' },
  { id: 'water_deep',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/WaterDeep.png' },
  { id: 'sand_bank',     passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Ground/Sand.png' },
  {
    id: 'reeds', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'sand_bank', regenSeconds: 60,
    spriteFrame: 'Ground/GrassTall.png',
  },
  { id: 'mud', passable: true, speedMod: 0.5, destructible: false, spriteFrame: 'Ground/Mud.png' },

  // ── Desert ────────────────────────────────────────────────────────────────
  { id: 'sand',      passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'Ground/Sand.png' },
  { id: 'sand_dune', passable: true, speedMod: 0.7, destructible: false, spriteFrame: 'Ground/SandDune.png' },
  {
    id: 'dry_rock', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 1, max: 3, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 3, chance: 0.4 }],
    becomesOnGather: 'sand', regenSeconds: 150,
    spriteFrame: 'Nature/RockSmall.png',
  },
  {
    id: 'cactus', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'sand', regenSeconds: 120,
    spriteFrame: 'Nature/Cactus.png',
  },
  { id: 'dry_grass',   passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Nature/Tumbleweed.png' },
  { id: 'oasis_water', passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/WaterOasis.png' },
  { id: 'quicksand',   passable: true,  speedMod: 0.3, destructible: false, spriteFrame: 'Ground/GrassDead.png' },

  // ── Village — single-sprite buildings ─────────────────────────────────────
  { id: 'cobblestone',  passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'Ground/GrassDead.png' },
  { id: 'house_hut',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Huts.png' },
  { id: 'house_cabin',  passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Houses.png' },
  { id: 'barracks',     passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Barracks.png' },
  { id: 'chapel',       passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Chapels.png' },
  { id: 'tavern',       passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Taverns.png' },
  { id: 'well',         passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Miscellaneous/Well.png' },
  { id: 'market_stall', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Market.png' },
  { id: 'workshop',     passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Workshops.png' },
  { id: 'quest_board',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/QuestBoard.png' },
  { id: 'street_sign',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/StreetSign.png' },
  { id: 'tombstone',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Miscellaneous/Tombstones.png' },
  { id: 'garden_plot',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  {
    id: 'wheat_field', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 3, chance: 1 }],
    becomesOnGather: 'garden_plot', regenSeconds: 180,
    spriteFrame: 'Nature/Wheatfield.png',
  },

  // ── Dungeon ───────────────────────────────────────────────────────────────
  { id: 'dungeon_entrance',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_floor',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_wall',        passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_stairs_down', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_stairs_up',   passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_pillar',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_trap',        passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },
  { id: 'dungeon_chest',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Chests.png' },
  { id: 'dungeon_altar',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Dungeon.png' },

  // ── Special / Interior ────────────────────────────────────────────────────
  { id: 'house_exit', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Portal.png' },
  { id: 'workbench',   passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Workshops.png' },
  { id: 'chest',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Chests.png' },
  { id: 'void',        passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/GrassDead.png' },
]
