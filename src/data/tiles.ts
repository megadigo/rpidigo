import type { TileDefinition } from '../registry/types'

export const tiles: TileDefinition[] = [
  // ── Plains ───────────────────────────────────────────────────────────────
  { id: 'grass',         passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  { id: 'grass_tall',    passable: true,  speedMod: 0.7, destructible: false, spriteFrame: 'Ground/TexturedGrass.png' },
  { id: 'flower_yellow', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  { id: 'flower_red',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  { id: 'dirt_path',     passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  { id: 'rock_small',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Nature/Rocks.png' },
  {
    id: 'rock_large', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 2, max: 4, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    becomesOnGather: 'grass', regenSeconds: 120,
    spriteFrame: 'Nature/Rocks.png',
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  { id: 'grass_dark', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'Ground/TexturedGrass.png' },
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
  {
    id: 'tree_dead', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'chop',
    dropTable: [{ itemId: 'wood', min: 1, max: 3, chance: 1 }, { itemId: 'fiber', min: 1, max: 2, chance: 0.5 }],
    becomesOnGather: 'stump', regenSeconds: 120,
    spriteFrame: 'Nature/DeadTrees.png',
  },
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
    spriteFrame: 'Ground/TexturedGrass.png',
  },
  { id: 'log',       passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Nature/DeadTrees.png' },
  { id: 'moss_rock', passable: false, speedMod: 0,   destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 1, max: 3, chance: 1 }],
    becomesOnGather: 'grass_dark', regenSeconds: 120,
    spriteFrame: 'Nature/Rocks.png',
  },
  { id: 'stump', passable: true, speedMod: 0.9, destructible: false, spriteFrame: 'Nature/DeadTrees.png' },

  // ── River / Water ─────────────────────────────────────────────────────────
  { id: 'water_shallow', passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Shore.png' },
  { id: 'water_deep',    passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Cliff-Water.png' },
  { id: 'sand_bank',     passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Ground/Shore.png' },
  {
    id: 'reeds', passable: true, speedMod: 0.8, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'sand_bank', regenSeconds: 60,
    spriteFrame: 'Ground/Shore.png',
  },
  { id: 'bridge', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Bridge.png' },
  { id: 'mud',    passable: true,  speedMod: 0.5, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },

  // ── Desert ────────────────────────────────────────────────────────────────
  { id: 'sand',        passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  { id: 'sand_dune',   passable: true,  speedMod: 0.7, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  {
    id: 'dry_rock', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'mine',
    dropTable: [{ itemId: 'stone', min: 1, max: 3, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 3, chance: 0.4 }],
    becomesOnGather: 'sand', regenSeconds: 150,
    spriteFrame: 'Nature/Rocks.png',
  },
  {
    id: 'cactus', passable: false, speedMod: 0, destructible: true,
    gatherAction: 'cut',
    dropTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 1 }],
    becomesOnGather: 'sand', regenSeconds: 120,
    spriteFrame: 'Nature/Cactus.png',
  },
  { id: 'dry_grass',    passable: true,  speedMod: 0.9, destructible: false, spriteFrame: 'Nature/Tumbleweed.png' },
  { id: 'oasis_water',  passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Shore.png' },
  { id: 'quicksand',    passable: true,  speedMod: 0.3, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },

  // ── Village ───────────────────────────────────────────────────────────────
  { id: 'cobblestone',     passable: true,  speedMod: 1.1, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  { id: 'house_floor',     passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/Grass.png' },
  { id: 'house_wall',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'house_door',      passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'house_roof',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'well',            passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Objects/Well.png' },
  { id: 'fence',           passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Objects/Fence.png' },
  { id: 'market_stall',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'blacksmith_forge',passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'tavern_sign',     passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Signs.png' },
  { id: 'lantern',         passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Torch.png' },
  { id: 'garden_plot',     passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },

  // ── Dungeon ───────────────────────────────────────────────────────────────
  { id: 'dungeon_entrance',    passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'dungeon_floor',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  { id: 'dungeon_wall',        passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Cliff-Wall.png' },
  { id: 'dungeon_door',        passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'dungeon_stairs_down', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Ladder.png' },
  { id: 'dungeon_stairs_up',   passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Miscellaneous/Ladder.png' },
  { id: 'dungeon_torch',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Torch.png' },
  { id: 'dungeon_pillar',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Cliff-Wall.png' },
  { id: 'dungeon_trap',        passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Ground/DeadGrass.png' },
  { id: 'dungeon_chest',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Chest.png' },
  { id: 'dungeon_altar',       passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Chest.png' },

  // ── Special / Shared ──────────────────────────────────────────────────────
  { id: 'house',     passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Buildings/Wood/Houses.png' },
  { id: 'workbench', passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Chest.png' },
  { id: 'chest',     passable: true,  speedMod: 1.0, destructible: false, spriteFrame: 'Objects/Chest.png' },
  { id: 'void',      passable: false, speedMod: 0,   destructible: false, spriteFrame: 'Ground/Cliff-Wall.png' },
]
