import type { EnemyDefinition } from '../registry/types'

/**
 * Standard patrol + aggro + chase + attack script.
 * Globals injected by ScriptExecutor: state, hp, x, y, spawn_x, spawn_y,
 * memory, nearby_players, aggro_range, power, random.
 * Action callbacks: move(dx,dy), attack(id), set_state(s), set_memory(k,v).
 */
const patrol_chase = [
  "if state == 'idle':",
  "    found = None",
  "    for p in nearby_players:",
  "        if max(abs(p['x'] - x), abs(p['y'] - y)) <= aggro_range:",
  "            found = p",
  "            break",
  "    if found:",
  "        set_state('chasing')",
  "        set_memory('target_id', found['id'])",
  "    else:",
  "        move(random.randint(-1, 1), random.randint(-1, 1))",
  "elif state == 'chasing':",
  "    target = None",
  "    for p in nearby_players:",
  "        if p['id'] == memory.get('target_id'):",
  "            target = p",
  "            break",
  "    if target is None and nearby_players:",
  "        target = nearby_players[0]",
  "    if target is None:",
  "        set_state('idle')",
  "    else:",
  "        dist = max(abs(target['x'] - x), abs(target['y'] - y))",
  "        if dist > aggro_range * 2:",
  "            set_state('idle')",
  "        elif dist <= 1:",
  "            attack(target['id'])",
  "        else:",
  "            dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)",
  "            dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)",
  "            move(dx, dy)",
].join('\n')

export const enemies: EnemyDefinition[] = [
  // ── Plains ────────────────────────────────────────────────────────────────
  {
    id: 'wolf_weak', baseType: 'wolf', variant: 'weak', displayName: 'Wolf',
    baseHp: 30, basePower: 6, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [1, 3], lootTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 0.7 }],
    behaviorScript: patrol_chase, spriteFrame: 'wolf.png',
  },
  {
    id: 'wolf_strong', baseType: 'wolf', variant: 'strong', displayName: 'Dire Wolf',
    baseHp: 55, basePower: 14, baseMp: 0, aggroRange: 6, speed: 'fast',
    levelRange: [3, 7], lootTable: [{ itemId: 'fiber', min: 2, max: 4, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'wolf.png',
  },
  {
    id: 'bandit_weak', baseType: 'bandit', variant: 'weak', displayName: 'Bandit',
    baseHp: 40, basePower: 8, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [2, 5],
    lootTable: [{ itemId: 'gold_coin', min: 5, max: 15, chance: 0.9 }, { itemId: 'wood', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrol_chase, spriteFrame: 'bandit_weak.png',
    stealGold: [2, 8],
  },
  {
    id: 'bandit_strong', baseType: 'bandit', variant: 'strong', displayName: 'Bandit Captain',
    baseHp: 80, basePower: 16, baseMp: 0, aggroRange: 7, speed: 'normal',
    levelRange: [5, 10],
    lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    behaviorScript: patrol_chase, spriteFrame: 'bandit_strong.png',
    stealGold: [5, 20],
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  {
    id: 'giant_spider_weak', baseType: 'giant_spider', variant: 'weak', displayName: 'Giant Spider',
    baseHp: 35, basePower: 9, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [2, 6], lootTable: [{ itemId: 'fiber', min: 2, max: 5, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'giant_spider.png',
  },
  {
    id: 'giant_spider_venomous', baseType: 'giant_spider', variant: 'venomous', displayName: 'Venomous Spider',
    baseHp: 50, basePower: 12, baseMp: 0, aggroRange: 6, speed: 'fast',
    levelRange: [5, 9], lootTable: [{ itemId: 'fiber', min: 3, max: 6, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'giant_spider.png',
    special: ['poison'],
  },
  {
    id: 'goblin_scout_weak', baseType: 'goblin_scout', variant: 'weak', displayName: 'Goblin Scout',
    baseHp: 28, basePower: 7, baseMp: 0, aggroRange: 7, speed: 'fast',
    levelRange: [1, 4], lootTable: [{ itemId: 'gold_coin', min: 2, max: 8, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'goblin_scout_weak.png',
  },
  {
    id: 'treant_strong', baseType: 'treant', variant: 'strong', displayName: 'Treant',
    baseHp: 120, basePower: 20, baseMp: 0, aggroRange: 3, speed: 'slow',
    levelRange: [7, 12], lootTable: [{ itemId: 'wood', min: 4, max: 8, chance: 1 }, { itemId: 'fiber', min: 2, max: 4, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'treant.png',
    special: ['ignores_walls'],
  },

  // ── River ─────────────────────────────────────────────────────────────────
  {
    id: 'river_troll_weak', baseType: 'river_troll', variant: 'weak', displayName: 'River Troll',
    baseHp: 60, basePower: 12, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'stone', min: 1, max: 3, chance: 0.7 }],
    behaviorScript: patrol_chase, spriteFrame: 'river_troll.png',
  },
  {
    id: 'river_troll_strong', baseType: 'river_troll', variant: 'strong', displayName: 'Cave Troll',
    baseHp: 100, basePower: 22, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [6, 11], lootTable: [{ itemId: 'stone', min: 2, max: 5, chance: 0.9 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrol_chase, spriteFrame: 'river_troll.png',
  },
  {
    id: 'crocodile_weak', baseType: 'crocodile', variant: 'weak', displayName: 'Crocodile',
    baseHp: 50, basePower: 11, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [2, 6], lootTable: [{ itemId: 'fiber', min: 1, max: 3, chance: 0.7 }],
    behaviorScript: patrol_chase, spriteFrame: 'crocodile.png',
  },
  {
    id: 'water_spirit_weak', baseType: 'water_spirit', variant: 'weak', displayName: 'Water Spirit',
    baseHp: 40, basePower: 10, baseMp: 30, aggroRange: 6, speed: 'normal',
    levelRange: [3, 7], lootTable: [{ itemId: 'gold_coin', min: 5, max: 12, chance: 0.6 }],
    behaviorScript: patrol_chase, spriteFrame: 'water_spirit.png',
  },
  {
    id: 'water_spirit_enraged', baseType: 'water_spirit', variant: 'enraged', displayName: 'Enraged Spirit',
    baseHp: 65, basePower: 18, baseMp: 50, aggroRange: 8, speed: 'fast',
    levelRange: [7, 12], lootTable: [{ itemId: 'gold_coin', min: 10, max: 25, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'water_spirit.png',
    special: ['area'],
  },

  // ── Desert ────────────────────────────────────────────────────────────────
  {
    id: 'scorpion_weak', baseType: 'scorpion', variant: 'weak', displayName: 'Scorpion',
    baseHp: 30, basePower: 8, baseMp: 0, aggroRange: 4, speed: 'normal',
    levelRange: [2, 5], lootTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 0.6 }],
    behaviorScript: patrol_chase, spriteFrame: 'scorpion.png',
    special: ['poison'],
  },
  {
    id: 'scorpion_giant', baseType: 'scorpion', variant: 'giant', displayName: 'Giant Scorpion',
    baseHp: 85, basePower: 18, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [5, 9], lootTable: [{ itemId: 'iron_ore', min: 1, max: 2, chance: 0.4 }, { itemId: 'fiber', min: 2, max: 4, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'scorpion.png',
    special: ['poison'],
  },
  {
    id: 'sand_worm_weak', baseType: 'sand_worm', variant: 'weak', displayName: 'Sand Worm',
    baseHp: 45, basePower: 10, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'stone', min: 1, max: 3, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'sand_worm.png',
  },
  {
    id: 'mummy_weak', baseType: 'mummy', variant: 'weak', displayName: 'Mummy',
    baseHp: 55, basePower: 11, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'fiber', min: 2, max: 4, chance: 0.9 }, { itemId: 'gold_coin', min: 3, max: 10, chance: 0.7 }],
    behaviorScript: patrol_chase, spriteFrame: 'mummy.png',
  },
  {
    id: 'desert_bandit_strong', baseType: 'desert_bandit', variant: 'strong', displayName: 'Desert Raider',
    baseHp: 90, basePower: 19, baseMp: 0, aggroRange: 7, speed: 'fast',
    levelRange: [6, 11], lootTable: [{ itemId: 'gold_coin', min: 20, max: 40, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'desert_bandit.png',
    stealGold: [8, 25],
  },

  // ── Village outskirts ─────────────────────────────────────────────────────
  {
    id: 'thief_weak', baseType: 'thief', variant: 'weak', displayName: 'Thief',
    baseHp: 25, basePower: 7, baseMp: 0, aggroRange: 5, speed: 'fast',
    levelRange: [1, 4], lootTable: [{ itemId: 'gold_coin', min: 3, max: 10, chance: 0.9 }],
    behaviorScript: patrol_chase, spriteFrame: 'thief.png',
    stealGold: [3, 12],
  },
  {
    id: 'dark_mage_weak', baseType: 'dark_mage', variant: 'weak', displayName: 'Dark Mage',
    baseHp: 35, basePower: 13, baseMp: 40, aggroRange: 8, speed: 'normal',
    levelRange: [3, 6], lootTable: [{ itemId: 'gold_coin', min: 8, max: 18, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'dark_mage_weak.png',
  },
  {
    id: 'dark_mage_strong', baseType: 'dark_mage', variant: 'strong', displayName: 'Warlock',
    baseHp: 65, basePower: 22, baseMp: 80, aggroRange: 9, speed: 'normal',
    levelRange: [7, 12], lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'dark_mage_strong.png',
    special: ['area'],
  },

  // ── Dungeon floor 1 ───────────────────────────────────────────────────────
  {
    id: 'skeleton_weak', baseType: 'skeleton', variant: 'weak', displayName: 'Skeleton',
    baseHp: 35, basePower: 9, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [1, 5], lootTable: [{ itemId: 'gold_coin', min: 2, max: 8, chance: 0.7 }, { itemId: 'stone', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrol_chase, spriteFrame: 'skeleton.png',
  },
  {
    id: 'slime_weak', baseType: 'slime', variant: 'weak', displayName: 'Slime',
    baseHp: 25, basePower: 5, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [1, 4], lootTable: [{ itemId: 'fiber', min: 1, max: 3, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'slime_weak.png',
  },
  {
    id: 'slime_corrosive', baseType: 'slime', variant: 'corrosive', displayName: 'Corrosive Slime',
    baseHp: 40, basePower: 10, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'fiber', min: 2, max: 4, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'slime_corrosive.png',
    special: ['poison'],
  },
  {
    id: 'zombie_weak', baseType: 'zombie', variant: 'weak', displayName: 'Zombie',
    baseHp: 45, basePower: 8, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [2, 6], lootTable: [{ itemId: 'fiber', min: 1, max: 2, chance: 0.6 }, { itemId: 'gold_coin', min: 1, max: 5, chance: 0.5 }],
    behaviorScript: patrol_chase, spriteFrame: 'zombie.png',
  },
  {
    id: 'zombie_armoured', baseType: 'zombie', variant: 'armoured', displayName: 'Armoured Zombie',
    baseHp: 75, basePower: 13, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [4, 8], lootTable: [{ itemId: 'iron_ore', min: 1, max: 2, chance: 0.3 }, { itemId: 'gold_coin', min: 5, max: 12, chance: 0.8 }],
    behaviorScript: patrol_chase, spriteFrame: 'zombie.png',
  },

  // ── Dungeon floor 2+ ──────────────────────────────────────────────────────
  {
    id: 'dark_knight_weak', baseType: 'dark_knight', variant: 'weak', displayName: 'Dark Knight',
    baseHp: 80, basePower: 18, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [5, 9], lootTable: [{ itemId: 'iron_ore', min: 2, max: 4, chance: 0.6 }, { itemId: 'gold_coin', min: 10, max: 25, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'dark_knight_weak.png',
  },
  {
    id: 'dark_knight_elite', baseType: 'dark_knight', variant: 'elite', displayName: 'Death Knight',
    baseHp: 130, basePower: 28, baseMp: 0, aggroRange: 7, speed: 'normal',
    levelRange: [8, 14], lootTable: [{ itemId: 'iron_ore', min: 3, max: 6, chance: 0.8 }, { itemId: 'gold_coin', min: 20, max: 50, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'dark_knight_elite.png',
  },
  {
    id: 'ghost_weak', baseType: 'ghost', variant: 'weak', displayName: 'Ghost',
    baseHp: 50, basePower: 15, baseMp: 30, aggroRange: 7, speed: 'normal',
    levelRange: [4, 8], lootTable: [{ itemId: 'gold_coin', min: 8, max: 18, chance: 0.7 }],
    behaviorScript: patrol_chase, spriteFrame: 'ghost.png',
    special: ['ignores_walls'],
  },
  {
    id: 'ghost_enraged', baseType: 'ghost', variant: 'enraged', displayName: 'Wraith',
    baseHp: 80, basePower: 24, baseMp: 60, aggroRange: 9, speed: 'fast',
    levelRange: [8, 13], lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 0.9 }],
    behaviorScript: patrol_chase, spriteFrame: 'ghost.png',
    special: ['ignores_walls'],
  },
  {
    id: 'necromancer_weak', baseType: 'necromancer', variant: 'weak', displayName: 'Necromancer',
    baseHp: 55, basePower: 16, baseMp: 70, aggroRange: 8, speed: 'normal',
    levelRange: [6, 10], lootTable: [{ itemId: 'gold_coin', min: 12, max: 28, chance: 1 }],
    behaviorScript: patrol_chase, spriteFrame: 'necromancer.png',
    special: ['summons_skeletons'],
  },
  {
    id: 'necromancer_strong', baseType: 'necromancer', variant: 'strong', displayName: 'Arch Necromancer',
    baseHp: 95, basePower: 26, baseMp: 120, aggroRange: 9, speed: 'normal',
    levelRange: [10, 16], lootTable: [{ itemId: 'gold_coin', min: 25, max: 60, chance: 1 }, { itemId: 'iron_ore', min: 2, max: 4, chance: 0.5 }],
    behaviorScript: patrol_chase, spriteFrame: 'necromancer.png',
    special: ['summons_skeletons', 'area'],
  },

  // ── Dungeon boss ──────────────────────────────────────────────────────────
  {
    id: 'dungeon_boss_strong', baseType: 'dungeon_boss', variant: 'strong', displayName: 'Dragon Lord',
    baseHp: 400, basePower: 45, baseMp: 150, aggroRange: 12, speed: 'normal',
    levelRange: [10, 20],
    lootTable: [
      { itemId: 'gold_coin', min: 100, max: 300, chance: 1 },
      { itemId: 'iron_ore',  min: 5,   max: 10,  chance: 1 },
    ],
    behaviorScript: patrol_chase, spriteFrame: 'dungeon_boss_strong.png',
    special: ['area', 'ignores_walls'],
  },
]
