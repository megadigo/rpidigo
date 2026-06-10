/**
 * All quest templates, grouped by category and ordered by difficulty (ascending `order`).
 *
 * Categories:
 *   combat      — kill enemies
 *   exploration — enter rooms, dungeons, walk distance
 *   gathering   — collect materials from the world / enemy drops
 *   crafting    — craft items at stations
 *   social      — use proximity chat
 *   economy     — collect gold
 *
 * One quest per category is active at a time.  On completion the engine
 * automatically activates the next quest (order + 1) in the same category.
 *
 * The first quest in each category is assigned to every new player on registration.
 */
import type { QuestTemplate, ActiveQuest, QuestCategory } from '../world/types.ts'

export const QUEST_TEMPLATES: QuestTemplate[] = [

  // ── COMBAT ─────────────────────────────────────────────────────────────────
  {
    id: 'combat_1', category: 'combat', order: 1,
    title: 'First Blood',
    description: 'Press A next to an enemy to attack it.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 1, label: 'Defeat 1 enemy' }],
    rewardXp: 20,
  },
  {
    id: 'combat_2', category: 'combat', order: 2,
    title: 'Pest Control',
    description: 'The land is crawling with hostile creatures. Put five down.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 5, label: 'Defeat 5 enemies' }],
    rewardXp: 50,
  },
  {
    id: 'combat_3', category: 'combat', order: 3,
    title: 'Wolf Hunter',
    description: 'Wolves roam the open plains and threaten travellers.',
    objectives: [{ counterKey: 'killsByEnemyId.wolf', goal: 3, label: 'Kill 3 wolves' }],
    rewardXp: 40,
  },
  {
    id: 'combat_4', category: 'combat', order: 4,
    title: 'Battle-Hardened',
    description: 'True warriors are forged through repeated combat.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 25, label: 'Defeat 25 enemies' }],
    rewardXp: 120,
  },
  {
    id: 'combat_5', category: 'combat', order: 5,
    title: 'Bandit Nemesis',
    description: 'Bandits prey on traders and peaceful folk alike. Drive them out.',
    objectives: [{ counterKey: 'killsByEnemyId.bandit', goal: 10, label: 'Kill 10 bandits' }],
    rewardXp: 100,
  },
  {
    id: 'combat_6', category: 'combat', order: 6,
    title: 'Monster Slayer',
    description: 'You have become a feared name among the creatures of this land.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 60, label: 'Defeat 60 enemies' }],
    rewardXp: 250,
  },
  {
    id: 'combat_7', category: 'combat', order: 7,
    title: 'Champion of the Realm',
    description: 'Legends are written about warriors who reach this milestone.',
    objectives: [{ counterKey: 'enemiesKilledTotal', goal: 150, label: 'Defeat 150 enemies' }],
    rewardXp: 500, rewardGold: 50,
  },

  // ── EXPLORATION ────────────────────────────────────────────────────────────
  {
    id: 'explore_1', category: 'exploration', order: 1,
    title: 'First Steps',
    description: 'The world is wide. Start exploring the land around your spawn.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 100, label: 'Walk 100 tiles' }],
    rewardXp: 10,
  },
  {
    id: 'explore_2', category: 'exploration', order: 2,
    title: 'Home Sweet Home',
    description: 'Every adventurer needs a base. Enter your personal house.',
    objectives: [{ counterKey: 'houseEntered', goal: 1, label: 'Enter your house' }],
    rewardXp: 10,
  },
  {
    id: 'explore_3', category: 'exploration', order: 3,
    title: 'Dungeon Delver',
    description: 'Ancient dungeons lie beneath the hills. Find one and step inside.',
    objectives: [{ counterKey: 'dungeonsVisited', goal: 1, label: 'Enter a dungeon' }],
    rewardXp: 30,
  },
  {
    id: 'explore_4', category: 'exploration', order: 4,
    title: 'Wanderer',
    description: 'The map holds many secrets for those willing to walk far enough.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 500, label: 'Walk 500 tiles' }],
    rewardXp: 60,
  },
  {
    id: 'explore_5', category: 'exploration', order: 5,
    title: 'Dungeon Explorer',
    description: 'You are drawn to the danger that lurks underground.',
    objectives: [{ counterKey: 'dungeonsVisited', goal: 3, label: 'Enter 3 dungeons' }],
    rewardXp: 100,
  },
  {
    id: 'explore_6', category: 'exploration', order: 6,
    title: 'Far Traveller',
    description: 'Most adventurers never leave the area they spawn in. You are not most people.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 2000, label: 'Walk 2 000 tiles' }],
    rewardXp: 150,
  },
  {
    id: 'explore_7', category: 'exploration', order: 7,
    title: 'Dungeon Master',
    description: 'You know every corner of every dungeon in the land.',
    objectives: [{ counterKey: 'dungeonsVisited', goal: 10, label: 'Enter 10 dungeons' }],
    rewardXp: 300, rewardGold: 30,
  },
  {
    id: 'explore_8', category: 'exploration', order: 8,
    title: 'World Legend',
    description: 'You have walked every road and crossed every border.',
    objectives: [{ counterKey: 'distanceTraveled', goal: 10000, label: 'Walk 10 000 tiles' }],
    rewardXp: 500, rewardGold: 100,
  },

  // ── GATHERING ──────────────────────────────────────────────────────────────
  {
    id: 'gather_1', category: 'gathering', order: 1,
    title: 'Skinner',
    description: 'Wolves and crabs leave useful leather behind. Collect some.',
    objectives: [{ counterKey: 'collectedByItemId.leather', goal: 5, label: 'Collect 5 leather' }],
    rewardXp: 25,
  },
  {
    id: 'gather_2', category: 'gathering', order: 2,
    title: 'Woodcutter',
    description: 'Wood is the foundation of every craft. Chop some trees.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 10, label: 'Collect 10 wood' }],
    rewardXp: 30,
  },
  {
    id: 'gather_3', category: 'gathering', order: 3,
    title: 'Stone Gatherer',
    description: 'Rocks dot the landscape. Mine them for building material.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 10, label: 'Collect 10 stone' }],
    rewardXp: 30,
  },
  {
    id: 'gather_4', category: 'gathering', order: 4,
    title: 'Lumberjack',
    description: 'A real lumberjack keeps the forest managed.',
    objectives: [{ counterKey: 'collectedByItemId.wood', goal: 30, label: 'Collect 30 wood' }],
    rewardXp: 80,
  },
  {
    id: 'gather_5', category: 'gathering', order: 5,
    title: 'Quarryman',
    description: 'Stone is heavy — and you have lifted a lot of it.',
    objectives: [{ counterKey: 'collectedByItemId.stone', goal: 30, label: 'Collect 30 stone' }],
    rewardXp: 80,
  },
  {
    id: 'gather_6', category: 'gathering', order: 6,
    title: 'Miner',
    description: 'Iron ore hides deep in the rocks and dungeons.',
    objectives: [{ counterKey: 'collectedByItemId.iron_ore', goal: 15, label: 'Collect 15 iron ore' }],
    rewardXp: 120,
  },
  {
    id: 'gather_7', category: 'gathering', order: 7,
    title: 'Master Gatherer',
    description: 'Every resource of the land is at your command.',
    objectives: [
      { counterKey: 'collectedByItemId.wood',    goal: 80, label: 'Collect 80 wood' },
      { counterKey: 'collectedByItemId.stone',   goal: 80, label: 'Collect 80 stone' },
    ],
    rewardXp: 300, rewardGold: 50,
  },

  // ── CRAFTING ───────────────────────────────────────────────────────────────
  {
    id: 'craft_1', category: 'crafting', order: 1,
    title: 'First Craft',
    description: 'Open your house workbench and craft something. Press A adjacent to it.',
    objectives: [{ counterKey: 'craftsDone', goal: 1, label: 'Complete 1 craft' }],
    rewardXp: 20,
  },
  {
    id: 'craft_2', category: 'crafting', order: 2,
    title: 'Apprentice',
    description: 'Practice makes perfect. Craft several items at any station.',
    objectives: [{ counterKey: 'craftsDone', goal: 5, label: 'Complete 5 crafts' }],
    rewardXp: 80,
  },
  {
    id: 'craft_3', category: 'crafting', order: 3,
    title: 'Journeyman Crafter',
    description: 'You are no longer a beginner.',
    objectives: [{ counterKey: 'craftsDone', goal: 15, label: 'Complete 15 crafts' }],
    rewardXp: 150,
  },
  {
    id: 'craft_4', category: 'crafting', order: 4,
    title: 'Expert Crafter',
    description: 'Visit the blacksmith forge to smelt iron and forge better gear.',
    objectives: [{ counterKey: 'craftsDone', goal: 30, label: 'Complete 30 crafts' }],
    rewardXp: 300,
  },
  {
    id: 'craft_5', category: 'crafting', order: 5,
    title: 'Master Craftsman',
    description: 'Your name is known among smiths and crafters across the land.',
    objectives: [{ counterKey: 'craftsDone', goal: 60, label: 'Complete 60 crafts' }],
    rewardXp: 600, rewardGold: 100,
  },

  // ── SOCIAL ─────────────────────────────────────────────────────────────────
  {
    id: 'social_1', category: 'social', order: 1,
    title: 'Chatterbox',
    description: 'Other adventurers share these lands. Press Enter and say something.',
    objectives: [{ counterKey: 'chatMessagesSent', goal: 1, label: 'Send a chat message' }],
    rewardXp: 5,
  },
  {
    id: 'social_2', category: 'social', order: 2,
    title: 'Socialite',
    description: 'You are becoming a familiar face in the local chat.',
    objectives: [{ counterKey: 'chatMessagesSent', goal: 10, label: 'Send 10 chat messages' }],
    rewardXp: 30,
  },
  {
    id: 'social_3', category: 'social', order: 3,
    title: 'Town Crier',
    description: 'You never miss a chance to share your thoughts.',
    objectives: [{ counterKey: 'chatMessagesSent', goal: 50, label: 'Send 50 chat messages' }],
    rewardXp: 100, rewardGold: 20,
  },

  // ── ECONOMY ────────────────────────────────────────────────────────────────
  {
    id: 'economy_1', category: 'economy', order: 1,
    title: 'Coin Purse',
    description: 'Gold is the lifeblood of any adventure. Collect some from slain enemies.',
    objectives: [{ counterKey: 'goldCollectedTotal', goal: 50, label: 'Collect 50 gold from enemies' }],
    rewardXp: 30,
  },
  {
    id: 'economy_2', category: 'economy', order: 2,
    title: 'Gold Hunter',
    description: 'The wealthier enemies carry a surprising amount of coin.',
    objectives: [{ counterKey: 'goldCollectedTotal', goal: 200, label: 'Collect 200 gold total' }],
    rewardXp: 100,
  },
  {
    id: 'economy_3', category: 'economy', order: 3,
    title: 'Treasure Seeker',
    description: 'You have learned where the gold flows in this world.',
    objectives: [{ counterKey: 'goldCollectedTotal', goal: 500, label: 'Collect 500 gold total' }],
    rewardXp: 200, rewardGold: 30,
  },
  {
    id: 'economy_4', category: 'economy', order: 4,
    title: 'Rich Adventurer',
    description: 'Most people never see this much gold in a lifetime.',
    objectives: [{ counterKey: 'goldCollectedTotal', goal: 2000, label: 'Collect 2 000 gold total' }],
    rewardXp: 400, rewardGold: 100,
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
