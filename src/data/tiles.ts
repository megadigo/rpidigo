import type { TileDefinition } from '../registry/types'

export const tiles: TileDefinition[] = [
  // ── Plains ───────────────────────────────────────────────────────────────
  { id: 'grass',         passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Ground/Grass.png' },
  { id: 'grass_tall',    passable: true,  speedMod: 0.6, destructible: false, spriteFrame: 'World/Ground/GrassTall.png' },
  { id: 'flower_yellow', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Ground/GrassFlowerYellow.png' },
  { id: 'flower_red',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Ground/GrassFlowerRed.png' },
  { id: 'dirt_path',     passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'World/Ground/PathDirt.png' },
  { id: 'rock_small',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Nature/RockSmall.png' },
  {
    id: 'rock_large', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine', gatherCharges: 3,
    dropTable: [{ itemId: 'stone', min: 1, max: 2, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    regenSeconds: 120,
    spriteFrame: 'World/Nature/RocksBig.png',
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  { id: 'grass_dark', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'World/Ground/GrassDark.png' },
  {
    id: 'tree_oak', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'chop', gatherCharges: 3,
    dropTable: [{ itemId: 'wood', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'stump', regenSeconds: 180,
    spriteFrame: 'World/Nature/Trees.png',
  },
  {
    id: 'tree_pine', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'chop', gatherCharges: 3,
    dropTable: [{ itemId: 'wood', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'stump', regenSeconds: 180,
    spriteFrame: 'World/Nature/PineTrees.png',
  },
  { id: 'coconut_tree', passable: false, speedMod: 0, destructible: false, spriteFrame: 'World/Nature/CoconutTrees.png' },
  {
    id: 'bush', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut', gatherCharges: 2,
    dropTable: [],
    regenSeconds: 60,
    spriteFrame: 'World/Nature/Bush.png',
  },
  {
    id: 'mushroom', passable: true, speedMod: 1.0, destructible: true,
    gatherAction: 'pick', gatherCharges: 1,
    dropTable: [{ itemId: 'mushroom_item', min: 1, max: 2, chance: 1 }],
    regenSeconds: 90,
    spriteFrame: 'World/Nature/Mushroom.png',
  },
  { id: 'log',       passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'World/Nature/Log.png' },
  { id: 'moss_rock', passable: false, speedMod: 0,   destructible: true,
    gatherAction: 'mine', gatherCharges: 2,
    dropTable: [{ itemId: 'stone', min: 1, max: 2, chance: 1 }],
    regenSeconds: 120,
    spriteFrame: 'World/Nature/RockMoss.png',
  },
  { id: 'stump', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'World/Nature/Stump.png' },

  // ── River / Water ─────────────────────────────────────────────────────────
  { id: 'water_shallow', passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Ground/WaterShallow.png' },
  { id: 'water_deep',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Ground/WaterDeep.png' },
  { id: 'sand_bank',     passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'World/Ground/SandBank.png' },
  {
    id: 'reeds', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut', gatherCharges: 2,
    dropTable: [],
    regenSeconds: 60,
    spriteFrame: 'World/Nature/Reeds.png',
  },
  { id: 'mud', passable: true, speedMod: 0.5, destructible: false, spriteFrame: 'World/Ground/Mud.png' },

  // ── Desert ────────────────────────────────────────────────────────────────
  { id: 'sand',      passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'World/Ground/Sand.png' },
  { id: 'sand_dune', passable: true, speedMod: 0.7, destructible: false, spriteFrame: 'World/Ground/SandDune.png' },
  {
    id: 'dry_rock', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine', gatherCharges: 3,
    dropTable: [{ itemId: 'stone', min: 1, max: 2, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 3, chance: 0.4 }],
    regenSeconds: 150,
    spriteFrame: 'World/Nature/DryRock.png',
  },
  {
    id: 'cactus', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'cut', gatherCharges: 2,
    dropTable: [],
    regenSeconds: 120,
    spriteFrame: 'World/Nature/Cactus.png',
  },
  { id: 'dry_grass',   passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'World/Nature/Tumbleweed.png' },
  { id: 'oasis_water', passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Ground/WaterOasis.png' },
  { id: 'quicksand',   passable: true,  speedMod: 0.3, destructible: false, spriteFrame: 'World/Ground/Quicksand.png' },

  // ── Village — world-visible buildings ────────────────────────────────────
  { id: 'cobblestone',  passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'World/Ground/Cobblestone.png' },
  { id: 'house_hut',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Huts.png' },
  { id: 'house_cabin',  passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Houses.png' },
  { id: 'barracks',     passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Barracks.png' },
  { id: 'chapel',       passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Chapels.png' },
  { id: 'tavern',       passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Taverns.png' },
  { id: 'well',         passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Well.png' },
  { id: 'market_stall', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Buildings/Market.png' },
  { id: 'workshop',     passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Workshops.png' },
  { id: 'quest_board',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Buildings/QuestBoard.png' },
  { id: 'street_sign',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Buildings/StreetSign.png' },
  { id: 'tombstone',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Buildings/Tombstone.png' },
  { id: 'garden_plot',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Ground/GardenPlot.png' },
  {
    id: 'wheat_field', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut', gatherCharges: 2,
    dropTable: [],
    regenSeconds: 180,
    spriteFrame: 'World/Nature/Wheatfield.png',
  },

  // ── Dungeon ───────────────────────────────────────────────────────────────
  { id: 'dungeon_entrance',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'World/Buildings/DungeonEntrance.png' },
  { id: 'dungeon_floor',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/DungeonFloor.png' },
  { id: 'dungeon_wall',        passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Dungeon/DungeonWall.png' },
  { id: 'dungeon_stairs_down', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/StairDown.png' },
  { id: 'dungeon_stairs_up',   passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/StairUp.png' },
  { id: 'dungeon_pillar',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Dungeon/DungeonPillar.png' },
  { id: 'dungeon_trap',        passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/DungeonTrap.png' },
  { id: 'dungeon_chest',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/Chest.png' },
  { id: 'dungeon_altar',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Dungeon/DungeonAltar.png' },
  { id: 'dungeon_tombstones',  passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Dungeon/Tombstone.png' },

  // ── House / Interior ──────────────────────────────────────────────────────
  { id: 'house_floor', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'House/HouseFloor.png' },
  { id: 'house_exit',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'House/Door.png' },
  { id: 'workbench',   passable: false, speedMod: 0,   destructible: false, spriteFrame: 'House/WorkBench.png' },
  { id: 'chest',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'House/Chest.png' },
  { id: 'void',        passable: false, speedMod: 0,   destructible: false, spriteFrame: 'World/Ground/Void.png' },

  // ── Cellars (under village houses) ───────────────────────────────────────
  { id: 'cellar_floor',      passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Cellars/CellarFloor.png' },
  { id: 'cellar_wall',       passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Cellars/CellarWall.png' },
  { id: 'cellar_chest',      passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Cellars/CellarChest.png' },
  { id: 'cellar_trap',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Cellars/CellarTrap.png' },
  { id: 'cellar_stairs_up',  passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Cellars/CellarStairsUp.png' },
]
