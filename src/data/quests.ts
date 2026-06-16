/**
 * All quest templates, grouped by category and ordered by difficulty (ascending `order`).
 *
 * Categories:
 *   combat    — kill enemies
 *   gathering — collect materials from the world / enemy drops, and craft items at stations
 *
 * One quest per category is active at a time.  On completion the engine
 * automatically activates the next quest (order + 1) in the same category,
 * and keeps advancing through any subsequent quests that are already met
 * (e.g. on first login after a big batch of progress).
 *
 * The first quest in each category is assigned to every new player on registration.
 *
 * Reward XP follows a softened exponential curve (~25% growth per step) so early
 * quests are quick wins while later quests stay meaningful without overshadowing
 * combat-earned XP. Both categories use the same reward curve for balance.
 */
import type { QuestTemplate, ActiveQuest, QuestCategory } from '../world/types.ts'

export const QUEST_TEMPLATES: QuestTemplate[] = [

  // ── COMBAT ─────────────────────────────────────────────────────────────────
  {
    id: 'combat_1', category: 'combat', order: 1,
    title: 'First Blood',
    description: 'Press A next to an enemy to attack it.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 1, label: 'Defeat 1 enemy' }],
    rewardXp: 15,
  },
  {
    id: 'combat_2', category: 'combat', order: 2,
    title: 'Getting Started',
    description: 'A few more kills will sharpen your instincts.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 3, label: 'Defeat 3 enemies' }],
    rewardXp: 20,
  },
  {
    id: 'combat_3', category: 'combat', order: 3,
    title: 'Wolf Hunter',
    description: 'Wolves roam the open plains and threaten travellers.',
    objectives: [{ counterKey: 'killsByEnemyId.wolf', goal: 2, label: 'Kill 2 wolves' }],
    rewardXp: 25,
  },
  {
    id: 'combat_4', category: 'combat', order: 4,
    title: 'Pest Control',
    description: 'The land is crawling with hostile creatures. Thin them out.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 8, label: 'Defeat 8 enemies' }],
    rewardXp: 30,
  },
  {
    id: 'combat_5', category: 'combat', order: 5,
    title: 'Crab Cracker',
    description: 'Shore crabs guard the riverbanks with sharp claws.',
    objectives: [{ counterKey: 'killsByEnemyId.crab', goal: 3, label: 'Kill 3 crabs' }],
    rewardXp: 35,
  },
  {
    id: 'combat_6', category: 'combat', order: 6,
    title: 'Battle-Tested',
    description: 'Repeated combat is starting to forge a warrior.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 15, label: 'Defeat 15 enemies' }],
    rewardXp: 45,
  },
  {
    id: 'combat_7', category: 'combat', order: 7,
    title: 'Bandit Trouble',
    description: 'Bandits prey on traders and peaceful folk alike.',
    objectives: [{ counterKey: 'killsByEnemyId.bandit', goal: 5, label: 'Kill 5 bandits' }],
    rewardXp: 55,
  },
  {
    id: 'combat_8', category: 'combat', order: 8,
    title: 'Battle-Hardened',
    description: 'True warriors are forged through repeated combat.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 30, label: 'Defeat 30 enemies' }],
    rewardXp: 70,
  },
  {
    id: 'combat_9', category: 'combat', order: 9,
    title: 'Wolf Pack Slayer',
    description: 'The packs grow bolder. Show them who hunts whom.',
    objectives: [{ counterKey: 'killsByEnemyId.wolf', goal: 10, label: 'Kill 10 wolves' }],
    rewardXp: 90,
  },
  {
    id: 'combat_10', category: 'combat', order: 10,
    title: 'Seasoned Warrior',
    description: 'Your reputation as a fighter is spreading.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 50, label: 'Defeat 50 enemies' }],
    rewardXp: 110,
  },
  {
    id: 'combat_11', category: 'combat', order: 11,
    title: 'Bandit Nemesis',
    description: 'Drive the bandit gangs out for good.',
    objectives: [{ counterKey: 'killsByEnemyId.bandit', goal: 15, label: 'Kill 15 bandits' }],
    rewardXp: 140,
  },
  {
    id: 'combat_12', category: 'combat', order: 12,
    title: 'Monster Slayer',
    description: 'You have become a feared name among the creatures of this land.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 90, label: 'Defeat 90 enemies' }],
    rewardXp: 175,
  },
  {
    id: 'combat_13', category: 'combat', order: 13,
    title: 'Champion of the Realm',
    description: 'Legends are written about warriors who reach this milestone.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 150, label: 'Defeat 150 enemies' }],
    rewardXp: 220, rewardGold: 50,
  },

  // ── GATHERING & CRAFTING ───────────────────────────────────────────────────
  // 1-4: basic gathering | 5-6: intro crafting | 7-10: heavy gathering | 11-12: miner+master | 13-15: crafting chain
  {
    id: 'gather_3', category: 'gathering', order: 1,
    title: 'Woodcutter',
    description: 'Wood is the foundation of every craft. Chop some trees.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 10, label: 'Collect 10 wood' }],
    rewardXp: 15, rewardGold: 5,
  },
  {
    id: 'gather_4', category: 'gathering', order: 2,
    title: 'Stone Gatherer',
    description: 'Rocks dot the landscape. Mine them for building material.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 10, label: 'Collect 10 stone' }],
    rewardXp: 20, rewardGold: 5,
  },
  {
    id: 'gather_mushroom_1', category: 'gathering', order: 3,
    title: 'Mushroom Picker',
    description: 'Mushrooms grow in damp forests. Forage a few for cooking.',
    objectives: [{ counterKey: 'collectedByItemId.mushroom_item', goal: 8, label: 'Collect 8 mushrooms' }],
    rewardXp: 25, rewardGold: 5,
  },
  {
    id: 'gather_2', category: 'gathering', order: 4,
    title: 'Skinner',
    description: 'Wolves and crabs leave useful leather behind. Collect some.',
    objectives: [{ counterKey: 'collectedByItemId.leather', goal: 10, label: 'Collect 10 leather' }],
    rewardXp: 30, rewardGold: 5,
  },
  {
    id: 'gather_1', category: 'gathering', order: 5,
    title: 'First Craft',
    description: 'Open your house workbench and craft something. Press A adjacent to it.',
    objectives: [{ counterKey: 'craftsDone', goal: 1, label: 'Complete 1 craft' }],
    rewardXp: 35, rewardGold: 8,
  },
  {
    id: 'gather_5', category: 'gathering', order: 6,
    title: 'Apprentice',
    description: 'Practice makes perfect. Craft several items at any station.',
    objectives: [{ counterKey: 'craftsDone', goal: 5, label: 'Complete 5 crafts' }],
    rewardXp: 45, rewardGold: 8,
  },
  {
    id: 'gather_7', category: 'gathering', order: 7,
    title: 'Lumberjack',
    description: 'A real lumberjack keeps the forest managed.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 30, label: 'Collect 30 wood' }],
    rewardXp: 55, rewardGold: 10,
  },
  {
    id: 'gather_8', category: 'gathering', order: 8,
    title: 'Quarryman',
    description: 'Stone is heavy — and you have lifted a lot of it.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 30, label: 'Collect 30 stone' }],
    rewardXp: 70, rewardGold: 10,
  },
  {
    id: 'gather_mushroom_2', category: 'gathering', order: 9,
    title: 'Mushroom Forager',
    description: 'The forest holds more secrets. Gather a larger haul of mushrooms.',
    objectives: [{ counterKey: 'collectedByItemId.mushroom_item', goal: 20, label: 'Collect 20 mushrooms' }],
    rewardXp: 90, rewardGold: 15,
  },
  {
    id: 'gather_6', category: 'gathering', order: 10,
    title: 'Tanner',
    description: 'A steady supply of leather keeps the armorer busy.',
    objectives: [{ counterKey: 'collectedByItemId.leather', goal: 20, label: 'Collect 20 leather' }],
    rewardXp: 110, rewardGold: 15,
  },
  {
    id: 'gather_10', category: 'gathering', order: 11,
    title: 'Miner',
    description: 'Iron ore hides deep in the rocks and dungeons.',
    objectives: [{ counterKey: 'collectedByItemId.iron_ore', goal: 15, label: 'Collect 15 iron ore' }],
    rewardXp: 140, rewardGold: 20,
  },
  {
    id: 'gather_11', category: 'gathering', order: 12,
    title: 'Master Gatherer',
    description: 'Every resource of the land is at your command.',
    objectives: [
      { counterKey: 'collectedByItemId.wood',  goal: 60, label: 'Collect 60 wood' },
      { counterKey: 'collectedByItemId.stone', goal: 60, label: 'Collect 60 stone' },
    ],
    rewardXp: 175, rewardGold: 25,
  },
  {
    id: 'gather_9', category: 'gathering', order: 13,
    title: 'Journeyman Crafter',
    description: 'A journeyman knows their tools. Craft leather armor at your workbench.',
    objectives: [
      { counterKey: 'craftsDone', goal: 15, label: 'Complete 15 crafts' },
      { counterKey: 'craftedByItemId.leather_chestplate', goal: 1, label: 'Craft a leather chestplate' },
    ],
    rewardXp: 220, rewardGold: 30,
  },
  {
    id: 'gather_12', category: 'gathering', order: 14,
    title: 'Expert Crafter',
    description: 'Head to the blacksmith forge and smelt iron into a deadly sword.',
    objectives: [
      { counterKey: 'craftsDone', goal: 30, label: 'Complete 30 crafts' },
      { counterKey: 'craftedByItemId.iron_sword', goal: 1, label: 'Forge an iron sword' },
    ],
    rewardXp: 275, rewardGold: 40,
  },
  {
    id: 'gather_13', category: 'gathering', order: 15,
    title: 'Master Craftsman',
    description: 'Descend into a dungeon and forge a shadow blade at the altar.',
    objectives: [
      { counterKey: 'craftsDone', goal: 60, label: 'Complete 60 crafts' },
      { counterKey: 'craftedByItemId.shadow_blade', goal: 1, label: 'Forge a shadow blade' },
    ],
    rewardXp: 345, rewardGold: 50,
  },

  // ── EXPLORATION ────────────────────────────────────────────────────────────
  // Tier 1: first contact with each location type
  // Tier 2: repeat visits to build familiarity
  // Tier 3: mastery
  {
    id: 'explore_1', category: 'exploration', order: 1,
    title: 'Homecoming',
    description: 'Find your house in the world and step inside.',
    objectives: [{ counterKey: 'houseEntered', goal: 1, label: 'Enter your house' }],
    rewardXp: 15, rewardGold: 5,
  },
  {
    id: 'explore_2', category: 'exploration', order: 2,
    title: 'First Steps',
    description: 'Set out and explore the land around you.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 100, label: 'Travel 100 tiles' }],
    rewardXp: 20, rewardGold: 5,
  },
  {
    id: 'explore_3', category: 'exploration', order: 3,
    title: 'Village Finder',
    description: 'Civilization lies out there. Find the nearest village.',
    objectives: [{ counterKey: 'villagesVisited', goal: 1, label: 'Discover 1 village' }],
    rewardXp: 25, rewardGold: 5,
  },
  {
    id: 'explore_4', category: 'exploration', order: 4,
    title: 'Dungeon Delver',
    description: 'Brave the darkness. Enter a dungeon.',
    objectives: [{ counterKey: 'dungeonsVisited', goal: 1, label: 'Enter 1 dungeon' }],
    rewardXp: 30, rewardGold: 5,
  },
  {
    id: 'explore_5', category: 'exploration', order: 5,
    title: 'Safe Harbour',
    description: 'Other adventurers have homes too. Visit 5 of them.',
    objectives: [{ counterKey: 'housesVisited', goal: 5, label: 'Visit 5 other houses' }],
    rewardXp: 35, rewardGold: 8,
  },
  {
    id: 'explore_6', category: 'exploration', order: 6,
    title: 'Wanderer',
    description: 'The road is long. Keep walking.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 500, label: 'Travel 500 tiles' }],
    rewardXp: 45, rewardGold: 8,
  },
  {
    id: 'explore_7', category: 'exploration', order: 7,
    title: 'Cartographer',
    description: 'Chart the region by visiting multiple villages.',
    objectives: [{ counterKey: 'villagesVisited', goal: 3, label: 'Discover 3 villages' }],
    rewardXp: 55, rewardGold: 10,
  },
  {
    id: 'explore_8', category: 'exploration', order: 8,
    title: 'Dungeon Crawler',
    description: 'Deeper and deeper. Some dungeons have multiple floors.',
    objectives: [{ counterKey: 'dungeonsVisited', goal: 5, label: 'Enter 5 dungeons' }],
    rewardXp: 70, rewardGold: 10,
  },
  {
    id: 'explore_9', category: 'exploration', order: 9,
    title: 'Pathfinder',
    description: 'Few have walked as far as you.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 2000, label: 'Travel 2000 tiles' }],
    rewardXp: 90, rewardGold: 15,
  },
  {
    id: 'explore_10', category: 'exploration', order: 10,
    title: 'Master Explorer',
    description: 'You have seen it all — villages, dungeons, and roads that never end.',
    objectives: [
      { counterKey: 'villagesVisited',  goal: 5,  label: 'Discover 5 villages' },
      { counterKey: 'dungeonsVisited',  goal: 10, label: 'Enter 10 dungeons' },
    ],
    rewardXp: 110, rewardGold: 25,
  },
]

/** Returns the first quest in each category as initial active quests for a new player. */
export function getFirstQuestsByCategory(): Record<string, ActiveQuest> {
  const now = Date.now()
  const result: Record<string, ActiveQuest> = {}
  const seen = new Set<QuestCategory>()

  for (const t of QUEST_TEMPLATES.sort((a, b) => a.order - b.order)) {
    if (seen.has(t.category)) continue
    seen.add(t.category)
    const q: ActiveQuest = {
      id:          t.id,
      category:    t.category,
      title:       t.title,
      description: t.description,
      objectives:  t.objectives,
      rewardXp:    t.rewardXp,
      acceptedAt:  now,
    }
    if (t.rewardGold !== undefined) q.rewardGold = t.rewardGold
    result[t.category] = q
  }
  return result
}
