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
  {
    id: 'gather_1', category: 'gathering', order: 1,
    title: 'First Craft',
    description: 'Open your house workbench and craft something. Press A adjacent to it.',
    objectives: [{ counterKey: 'craftsDone', goal: 1, label: 'Complete 1 craft' }],
    rewardXp: 15,
  },
  {
    id: 'gather_2', category: 'gathering', order: 2,
    title: 'Skinner',
    description: 'Wolves and crabs leave useful leather behind. Collect some.',
    objectives: [{ counterKey: 'collectedByItemId.leather', goal: 5, label: 'Collect 5 leather' }],
    rewardXp: 20,
  },
  {
    id: 'gather_3', category: 'gathering', order: 3,
    title: 'Woodcutter',
    description: 'Wood is the foundation of every craft. Chop some trees.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 10, label: 'Collect 10 wood' }],
    rewardXp: 25,
  },
  {
    id: 'gather_4', category: 'gathering', order: 4,
    title: 'Stone Gatherer',
    description: 'Rocks dot the landscape. Mine them for building material.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 10, label: 'Collect 10 stone' }],
    rewardXp: 30,
  },
  {
    id: 'gather_5', category: 'gathering', order: 5,
    title: 'Apprentice',
    description: 'Practice makes perfect. Craft several items at any station.',
    objectives: [{ counterKey: 'craftsDone', goal: 5, label: 'Complete 5 crafts' }],
    rewardXp: 35,
  },
  {
    id: 'gather_6', category: 'gathering', order: 6,
    title: 'Tanner',
    description: 'A steady supply of leather keeps the armorer busy.',
    objectives: [{ counterKey: 'collectedByItemId.leather', goal: 15, label: 'Collect 15 leather' }],
    rewardXp: 45,
  },
  {
    id: 'gather_7', category: 'gathering', order: 7,
    title: 'Lumberjack',
    description: 'A real lumberjack keeps the forest managed.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 30, label: 'Collect 30 wood' }],
    rewardXp: 55,
  },
  {
    id: 'gather_8', category: 'gathering', order: 8,
    title: 'Quarryman',
    description: 'Stone is heavy — and you have lifted a lot of it.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 30, label: 'Collect 30 stone' }],
    rewardXp: 70,
  },
  {
    id: 'gather_9', category: 'gathering', order: 9,
    title: 'Journeyman Crafter',
    description: 'You are no longer a beginner.',
    objectives: [{ counterKey: 'craftsDone', goal: 15, label: 'Complete 15 crafts' }],
    rewardXp: 90,
  },
  {
    id: 'gather_10', category: 'gathering', order: 10,
    title: 'Miner',
    description: 'Iron ore hides deep in the rocks and dungeons.',
    objectives: [{ counterKey: 'collectedByItemId.iron_ore', goal: 15, label: 'Collect 15 iron ore' }],
    rewardXp: 110,
  },
  {
    id: 'gather_11', category: 'gathering', order: 11,
    title: 'Master Gatherer',
    description: 'Every resource of the land is at your command.',
    objectives: [
      { counterKey: 'collectedByItemId.wood',  goal: 60, label: 'Collect 60 wood' },
      { counterKey: 'collectedByItemId.stone', goal: 60, label: 'Collect 60 stone' },
    ],
    rewardXp: 140,
  },
  {
    id: 'gather_12', category: 'gathering', order: 12,
    title: 'Expert Crafter',
    description: 'Visit the blacksmith forge to smelt iron and forge better gear.',
    objectives: [{ counterKey: 'craftsDone', goal: 30, label: 'Complete 30 crafts' }],
    rewardXp: 175,
  },
  {
    id: 'gather_13', category: 'gathering', order: 13,
    title: 'Master Craftsman',
    description: 'Your name is known among smiths and crafters across the land.',
    objectives: [{ counterKey: 'craftsDone', goal: 60, label: 'Complete 60 crafts' }],
    rewardXp: 220, rewardGold: 50,
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
