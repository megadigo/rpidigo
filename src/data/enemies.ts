import type { EnemyDefinition } from '../registry/types'
import patrolChase      from '../scripts/enemies/patrol_chase.py?raw'
import patrolOnly       from '../scripts/enemies/patrol_only.py?raw'
import patrolFlee       from '../scripts/enemies/patrol_flee.py?raw'
import patrolPack       from '../scripts/enemies/patrol_pack.py?raw'
import patrolAggressive from '../scripts/enemies/patrol_aggressive.py?raw'
import patrolPersistent from '../scripts/enemies/patrol_persistent.py?raw'

// ─── Behavior key:
//
//  patrol_only       — territorial, never chases; attacks only when adjacent
//  patrol_chase      — standard: patrol → aggro → chase → attack
//  patrol_flee       — coward: runs away, attacks only when cornered
//  patrol_pack       — passive until hit; then fights back aggressively
//  patrol_aggressive — relentless: wide aggro, tracks last known pos, 3× de-aggro range
//  patrol_persistent — slow to notice (½ aggro_range), but never fully de-aggros (undead)

export const enemies: EnemyDefinition[] = [
  // ── Plains ────────────────────────────────────────────────────────────────
  {
    // Timid lone wolf — backs away from humans, attacks only if cornered
    id: 'wolf_weak', baseType: 'wolf', variant: 'weak', displayName: 'Wolf',
    baseHp: 30, basePower: 4, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [1, 3], lootTable: [{ itemId: 'leather', min: 1, max: 2, chance: 0.7 }],
    behaviorScript: patrolOnly, spriteFrame: 'wolf.png',
  },
  {
    // Apex predator — attacks on sight, never gives up the chase
    id: 'wolf_strong', baseType: 'wolf', variant: 'strong', displayName: 'Dire Wolf',
    baseHp: 55, basePower: 8, baseMp: 0, aggroRange: 6, speed: 'fast',
    levelRange: [3, 7], lootTable: [{ itemId: 'leather', min: 1, max: 3, chance: 0.9 }],
    behaviorScript: patrolAggressive, spriteFrame: 'wolf.png',
  },
  {
    // Cowardly alone — won't attack first, but fights back hard when hit
    id: 'bandit_weak', baseType: 'bandit', variant: 'weak', displayName: 'Bandit',
    baseHp: 40, basePower: 5, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [2, 5],
    lootTable: [{ itemId: 'gold_coin', min: 5, max: 15, chance: 0.9 }, { itemId: 'wood', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrolPack, spriteFrame: 'bandit_weak.png',
    stealGold: [2, 8],
  },
  {
    // Confident captain — aggressive and relentless
    id: 'bandit_strong', baseType: 'bandit', variant: 'strong', displayName: 'Bandit Captain',
    baseHp: 80, basePower: 10, baseMp: 0, aggroRange: 7, speed: 'normal',
    levelRange: [5, 10],
    lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 1 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.2 }],
    behaviorScript: patrolAggressive, spriteFrame: 'bandit_strong.png',
    stealGold: [5, 20],
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  {
    // Fragile — hides from players, attacks only if they corner it
    id: 'giant_spider_weak', baseType: 'giant_spider', variant: 'weak', displayName: 'Giant Spider',
    baseHp: 35, basePower: 5, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [2, 6], lootTable: [],
    behaviorScript: patrolFlee, spriteFrame: 'giant_spider.png',
  },
  {
    // Venomous and lethal — attacks on sight, very fast
    id: 'giant_spider_venomous', baseType: 'giant_spider', variant: 'venomous', displayName: 'Venomous Spider',
    baseHp: 50, basePower: 7, baseMp: 0, aggroRange: 6, speed: 'fast',
    levelRange: [5, 9], lootTable: [],
    behaviorScript: patrolAggressive, spriteFrame: 'giant_spider.png',
    special: ['poison'],
  },
  {
    // Scout that runs and doesn't fight — fast, wide detection, pure flee
    id: 'goblin_scout_weak', baseType: 'goblin_scout', variant: 'weak', displayName: 'Goblin Scout',
    baseHp: 28, basePower: 4, baseMp: 0, aggroRange: 7, speed: 'fast',
    levelRange: [1, 4], lootTable: [{ itemId: 'gold_coin', min: 2, max: 8, chance: 0.8 }],
    behaviorScript: patrolFlee, spriteFrame: 'goblin_scout_weak.png',
  },
  {
    // Ancient guardian — extremely slow, never leaves its grove, attacks only adjacently
    id: 'treant_strong', baseType: 'treant', variant: 'strong', displayName: 'Treant',
    baseHp: 120, basePower: 12, baseMp: 0, aggroRange: 3, speed: 'slow',
    levelRange: [7, 12], lootTable: [{ itemId: 'wood', min: 4, max: 8, chance: 1 }],
    behaviorScript: patrolOnly, spriteFrame: 'treant.png',
    special: ['ignores_walls'],
  },

  // ── River ─────────────────────────────────────────────────────────────────
  {
    // Territorial bridge troll — stays near water, only attacks if approached
    id: 'river_troll_weak', baseType: 'river_troll', variant: 'weak', displayName: 'River Troll',
    baseHp: 60, basePower: 7, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'stone', min: 1, max: 3, chance: 0.7 }],
    behaviorScript: patrolOnly, spriteFrame: 'river_troll.png',
  },
  {
    // Cave troll — enraged, attacks anything that moves
    id: 'river_troll_strong', baseType: 'river_troll', variant: 'strong', displayName: 'Cave Troll',
    baseHp: 100, basePower: 13, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [6, 11], lootTable: [{ itemId: 'stone', min: 2, max: 5, chance: 0.9 }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrolAggressive, spriteFrame: 'river_troll.png',
  },
  {
    // Ambush predator — waits, then stalks prey with standard chase
    id: 'crocodile_weak', baseType: 'crocodile', variant: 'weak', displayName: 'Crocodile',
    baseHp: 50, basePower: 7, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [2, 6], lootTable: [{ itemId: 'leather', min: 1, max: 2, chance: 0.8 }],
    behaviorScript: patrolChase, spriteFrame: 'crocodile.png',
  },
  {
    // Ethereal — avoids direct combat, flees and attacks only when cornered
    id: 'water_spirit_weak', baseType: 'water_spirit', variant: 'weak', displayName: 'Water Spirit',
    baseHp: 40, basePower: 6, baseMp: 30, aggroRange: 6, speed: 'normal',
    levelRange: [3, 7], lootTable: [{ itemId: 'gold_coin', min: 5, max: 12, chance: 0.6 }],
    behaviorScript: patrolFlee, spriteFrame: 'water_spirit.png',
  },
  {
    // Fully enraged — attacks on sight, relentless
    id: 'water_spirit_enraged', baseType: 'water_spirit', variant: 'enraged', displayName: 'Enraged Spirit',
    baseHp: 65, basePower: 11, baseMp: 50, aggroRange: 8, speed: 'fast',
    levelRange: [7, 12], lootTable: [{ itemId: 'gold_coin', min: 10, max: 25, chance: 0.8 }],
    behaviorScript: patrolAggressive, spriteFrame: 'water_spirit.png',
    special: ['area'],
  },

  // ── Desert ────────────────────────────────────────────────────────────────
  {
    // Defensive — stays in its burrow area, attacks only if stepped on
    id: 'scorpion_weak', baseType: 'scorpion', variant: 'weak', displayName: 'Scorpion',
    baseHp: 30, basePower: 5, baseMp: 0, aggroRange: 4, speed: 'normal',
    levelRange: [2, 5], lootTable: [{ itemId: 'leather', min: 1, max: 1, chance: 0.6 }],
    behaviorScript: patrolOnly, spriteFrame: 'scorpion.png',
    special: ['poison'],
  },
  {
    // Large hunter — actively stalks prey across the sand
    id: 'scorpion_giant', baseType: 'scorpion', variant: 'giant', displayName: 'Giant Scorpion',
    baseHp: 85, basePower: 11, baseMp: 0, aggroRange: 5, speed: 'normal',
    levelRange: [5, 9], lootTable: [{ itemId: 'iron_ore', min: 1, max: 2, chance: 0.4 }, { itemId: 'leather', min: 1, max: 3, chance: 1 }],
    behaviorScript: patrolChase, spriteFrame: 'scorpion.png',
    special: ['poison'],
  },
  {
    // Burrower — stays near its tunnel, only attacks if disturbed
    id: 'sand_worm_weak', baseType: 'sand_worm', variant: 'weak', displayName: 'Sand Worm',
    baseHp: 45, basePower: 6, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'stone', min: 1, max: 3, chance: 0.8 }],
    behaviorScript: patrolOnly, spriteFrame: 'sand_worm.png',
  },
  {
    // Undead — slow to notice but relentlessly follows last known player position
    id: 'mummy_weak', baseType: 'mummy', variant: 'weak', displayName: 'Mummy',
    baseHp: 55, basePower: 7, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [3, 7], lootTable: [{ itemId: 'gold_coin', min: 3, max: 10, chance: 0.7 }],
    behaviorScript: patrolPersistent, spriteFrame: 'mummy.png',
  },
  {
    // Bold desert raider — attacks on sight and chases relentlessly
    id: 'desert_bandit_strong', baseType: 'desert_bandit', variant: 'strong', displayName: 'Desert Raider',
    baseHp: 90, basePower: 11, baseMp: 0, aggroRange: 7, speed: 'fast',
    levelRange: [6, 11], lootTable: [{ itemId: 'gold_coin', min: 20, max: 40, chance: 1 }],
    behaviorScript: patrolAggressive, spriteFrame: 'desert_bandit.png',
    stealGold: [8, 25],
  },

  // ── Village outskirts ─────────────────────────────────────────────────────
  {
    // Pure coward — runs away; attacks only if cornered (gold thief)
    id: 'thief_weak', baseType: 'thief', variant: 'weak', displayName: 'Thief',
    baseHp: 25, basePower: 4, baseMp: 0, aggroRange: 5, speed: 'fast',
    levelRange: [1, 4], lootTable: [{ itemId: 'gold_coin', min: 3, max: 10, chance: 0.9 }],
    behaviorScript: patrolFlee, spriteFrame: 'thief.png',
    stealGold: [3, 12],
  },
  {
    // Keeps distance — flees when player approaches, attacks only when cornered
    id: 'dark_mage_weak', baseType: 'dark_mage', variant: 'weak', displayName: 'Dark Mage',
    baseHp: 35, basePower: 8, baseMp: 40, aggroRange: 8, speed: 'normal',
    levelRange: [3, 6], lootTable: [{ itemId: 'gold_coin', min: 8, max: 18, chance: 0.8 }],
    behaviorScript: patrolFlee, spriteFrame: 'dark_mage_weak.png',
  },
  {
    // Powerful warlock — aggressive, wide detection, never retreats
    id: 'dark_mage_strong', baseType: 'dark_mage', variant: 'strong', displayName: 'Warlock',
    baseHp: 65, basePower: 13, baseMp: 80, aggroRange: 9, speed: 'normal',
    levelRange: [7, 12], lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 1 }],
    behaviorScript: patrolAggressive, spriteFrame: 'dark_mage_strong.png',
    special: ['area'],
  },

  // ── Dungeon floor 1 ───────────────────────────────────────────────────────
  {
    // Mindless undead — wanders aimlessly, attacks only when stumbled upon
    id: 'skeleton_weak', baseType: 'skeleton', variant: 'weak', displayName: 'Skeleton',
    baseHp: 35, basePower: 5, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [1, 5], lootTable: [{ itemId: 'gold_coin', min: 2, max: 8, chance: 0.7 }, { itemId: 'stone', min: 1, max: 2, chance: 0.3 }],
    behaviorScript: patrolOnly, spriteFrame: 'skeleton.png',
  },
  {
    // Dumb blob — oozes slowly, attacks only when touched
    id: 'slime_weak', baseType: 'slime', variant: 'weak', displayName: 'Slime',
    baseHp: 25, basePower: 3, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [1, 4], lootTable: [],
    behaviorScript: patrolOnly, spriteFrame: 'slime_weak.png',
  },
  {
    // Corrosive — slowly but steadily pursues anyone nearby
    id: 'slime_corrosive', baseType: 'slime', variant: 'corrosive', displayName: 'Corrosive Slime',
    baseHp: 40, basePower: 6, baseMp: 0, aggroRange: 4, speed: 'slow',
    levelRange: [3, 7], lootTable: [],
    behaviorScript: patrolChase, spriteFrame: 'slime_corrosive.png',
    special: ['poison'],
  },
  {
    // Classic zombie — short detection range, relentlessly shambles after prey
    id: 'zombie_weak', baseType: 'zombie', variant: 'weak', displayName: 'Zombie',
    baseHp: 45, basePower: 5, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [2, 6], lootTable: [{ itemId: 'gold_coin', min: 1, max: 5, chance: 0.5 }],
    behaviorScript: patrolPersistent, spriteFrame: 'zombie.png',
  },
  {
    // Heavy armour, relentless — same slow-notice, never-gives-up undead logic
    id: 'zombie_armoured', baseType: 'zombie', variant: 'armoured', displayName: 'Armoured Zombie',
    baseHp: 75, basePower: 8, baseMp: 0, aggroRange: 5, speed: 'slow',
    levelRange: [4, 8], lootTable: [{ itemId: 'iron_ore', min: 1, max: 2, chance: 0.3 }, { itemId: 'gold_coin', min: 5, max: 12, chance: 0.8 }],
    behaviorScript: patrolPersistent, spriteFrame: 'zombie.png',
  },

  // ── Dungeon floor 2+ ──────────────────────────────────────────────────────
  {
    // Trained soldier — standard patrol-chase, disciplined fighter
    id: 'dark_knight_weak', baseType: 'dark_knight', variant: 'weak', displayName: 'Dark Knight',
    baseHp: 80, basePower: 11, baseMp: 0, aggroRange: 6, speed: 'normal',
    levelRange: [5, 9], lootTable: [{ itemId: 'iron_ore', min: 2, max: 4, chance: 0.6 }, { itemId: 'gold_coin', min: 10, max: 25, chance: 1 }],
    behaviorScript: patrolChase, spriteFrame: 'dark_knight_weak.png',
  },
  {
    // Death knight — aggressive, wide aggro, never disengages
    id: 'dark_knight_elite', baseType: 'dark_knight', variant: 'elite', displayName: 'Death Knight',
    baseHp: 130, basePower: 17, baseMp: 0, aggroRange: 7, speed: 'normal',
    levelRange: [8, 14], lootTable: [{ itemId: 'iron_ore', min: 3, max: 6, chance: 0.8 }, { itemId: 'gold_coin', min: 20, max: 50, chance: 1 }],
    behaviorScript: patrolAggressive, spriteFrame: 'dark_knight_elite.png',
  },
  {
    // Haunter — avoids direct combat, flees but passes through walls
    id: 'ghost_weak', baseType: 'ghost', variant: 'weak', displayName: 'Ghost',
    baseHp: 50, basePower: 9, baseMp: 30, aggroRange: 7, speed: 'normal',
    levelRange: [4, 8], lootTable: [{ itemId: 'gold_coin', min: 8, max: 18, chance: 0.7 }],
    behaviorScript: patrolFlee, spriteFrame: 'ghost.png',
    special: ['ignores_walls'],
  },
  {
    // Wraith — fully enraged, aggressive, passes through walls
    id: 'ghost_enraged', baseType: 'ghost', variant: 'enraged', displayName: 'Wraith',
    baseHp: 80, basePower: 14, baseMp: 60, aggroRange: 9, speed: 'fast',
    levelRange: [8, 13], lootTable: [{ itemId: 'gold_coin', min: 15, max: 35, chance: 0.9 }],
    behaviorScript: patrolAggressive, spriteFrame: 'ghost.png',
    special: ['ignores_walls'],
  },
  {
    // Keeps distance — flees to maintain range, attacks only when cornered
    id: 'necromancer_weak', baseType: 'necromancer', variant: 'weak', displayName: 'Necromancer',
    baseHp: 55, basePower: 10, baseMp: 70, aggroRange: 8, speed: 'normal',
    levelRange: [6, 10], lootTable: [{ itemId: 'gold_coin', min: 12, max: 28, chance: 1 }],
    behaviorScript: patrolFlee, spriteFrame: 'necromancer.png',
    special: ['summons_skeletons'],
  },
  {
    // Arch necromancer — aggressive, overwhelming power
    id: 'necromancer_strong', baseType: 'necromancer', variant: 'strong', displayName: 'Arch Necromancer',
    baseHp: 95, basePower: 16, baseMp: 120, aggroRange: 9, speed: 'normal',
    levelRange: [10, 16], lootTable: [{ itemId: 'gold_coin', min: 25, max: 60, chance: 1 }, { itemId: 'iron_ore', min: 2, max: 4, chance: 0.5 }],
    behaviorScript: patrolAggressive, spriteFrame: 'necromancer.png',
    special: ['summons_skeletons', 'area'],
  },

  // ── Dungeon boss ──────────────────────────────────────────────────────────
  {
    // Boss — maximum aggression, huge detection range, never retreats
    id: 'dungeon_boss_strong', baseType: 'dungeon_boss', variant: 'strong', displayName: 'Dragon Lord',
    baseHp: 400, basePower: 27, baseMp: 150, aggroRange: 12, speed: 'normal',
    levelRange: [10, 20],
    lootTable: [
      { itemId: 'gold_coin', min: 100, max: 300, chance: 1 },
      { itemId: 'iron_ore',  min: 5,   max: 10,  chance: 1 },
    ],
    behaviorScript: patrolAggressive, spriteFrame: 'dungeon_boss_strong.png',
    special: ['area', 'ignores_walls'],
  },
]
