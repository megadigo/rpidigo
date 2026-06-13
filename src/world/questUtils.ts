/**
 * Quest utilities — completion checking and automatic category progression.
 *
 * `checkAndAdvanceQuestsLocally` is the single entry-point called after any
 * counter update.  It:
 *   1. Checks every active quest against the current progressCounters.
 *   2. Marks completed quests and unlocks the next in the same category.
 *   3. Applies reward XP + gold to the player in-place.
 *   4. Returns a Firebase update map to merge into the caller's update() call,
 *      plus titles of quests that were just completed (for UI notifications).
 */
import { setLocalPlayer } from '../player/Auth.ts'
import { QUEST_TEMPLATES } from '../data/quests.ts'
import type { PlayerInstance, ActiveQuest } from './types.ts'
import { db } from '../firebase.ts'
import { ref, push } from 'firebase/database'
import { xpForLevel } from './utils.ts'

// ─── Counter resolution ────────────────────────────────────────────────────────

function _resolveCounter(pc: PlayerInstance['progressCounters'], key: string): number {
  const parts = key.split('.')
  if (parts.length === 1) {
    const v = (pc as Record<string, unknown>)[key]
    return typeof v === 'number' ? v : 0
  }
  const map = (pc as Record<string, unknown>)[parts[0]]
  if (!map || typeof map !== 'object') return 0
  const v = (map as Record<string, unknown>)[parts[1]]
  return typeof v === 'number' ? v : 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface QuestAdvanceResult {
  /** Firebase update paths ready to merge into the caller's update() call. */
  updates: Record<string, unknown>
  /** Total XP already applied to player.xp (for display / further level-up checks). */
  xpGained: number
  /** Total gold already applied to player.gold. */
  goldGained: number
  /** Human-readable titles of quests that just completed. */
  completedTitles: string[]
  /** How many levels were gained from quest rewards (0 if none). */
  levelsGained: number
  /** Level before any quest-reward level-ups (for unlocks calculation). */
  levelBefore: number
  /** Total stat points granted from level-ups triggered by quest rewards. */
  statPointsGranted: number
}

/**
 * Check all active quests against current progressCounters, complete met quests,
 * and advance to the next quest in each category.
 *
 * Mutates `player` in-place (xp, gold, quests) and calls setLocalPlayer.
 * Returns Firebase update paths plus reward totals so the caller can merge them
 * into a single Firebase update() call.
 */
export function checkAndAdvanceQuestsLocally(player: PlayerInstance): QuestAdvanceResult {
  const result: QuestAdvanceResult = {
    updates:           {},
    xpGained:          0,
    goldGained:        0,
    completedTitles:   [],
    levelsGained:      0,
    levelBefore:       player.level,
    statPointsGranted: 0,
  }

  const pc       = player.progressCounters ?? {}
  const active   = { ...(player.quests?.active ?? {}) } as Record<string, ActiveQuest>
  const completed = { ...(player.quests?.completed ?? {}) } as Record<string, { completedAt: number }>

  for (const cat of Object.keys(active)) {
    // Keep completing and advancing within this category until we hit a quest
    // whose objectives are not yet met, or run out of quests.
    let quest: ActiveQuest | undefined = active[cat]
    while (quest) {
      const allMet = quest.objectives.every(
        obj => _resolveCounter(pc, obj.counterKey) >= obj.goal,
      )
      if (!allMet) break

      const now = Date.now()

      // Mark complete
      completed[quest.id] = { completedAt: now }
      result.updates[`players/${player.id}/quests/completed/${quest.id}`] = { completedAt: now }
      result.completedTitles.push(quest.title)

      // Apply rewards
      result.xpGained   += quest.rewardXp
      result.goldGained += quest.rewardGold ?? 0

      // Advance to next quest in this category
      const template = QUEST_TEMPLATES.find(t => t.id === quest!.id)
      const nextTemplate = template
        ? QUEST_TEMPLATES
            .filter(t => t.category === template.category && t.order > template.order)
            .sort((a, b) => a.order - b.order)[0]
        : undefined

      if (nextTemplate && !completed[nextTemplate.id]) {
        const nextActive: ActiveQuest = {
          id:          nextTemplate.id,
          category:    nextTemplate.category,
          title:       nextTemplate.title,
          description: nextTemplate.description,
          objectives:  nextTemplate.objectives,
          rewardXp:    nextTemplate.rewardXp,
          acceptedAt:  now,
        }
        if (nextTemplate.rewardGold !== undefined) nextActive.rewardGold = nextTemplate.rewardGold
        active[cat] = nextActive
        result.updates[`players/${player.id}/quests/active/${cat}`] = nextActive
        quest = nextActive
      } else {
        // Category finished — remove active slot
        delete active[cat]
        result.updates[`players/${player.id}/quests/active/${cat}`] = null
        quest = undefined
      }
    }
  }

  if (result.xpGained > 0 || result.goldGained > 0) {
    player.xp   = (player.xp ?? 0)   + result.xpGained
    player.gold = (player.gold ?? 0) + result.goldGained

    // Level-up loop — mirrors the logic in GameScene._resolveEnemyKill
    while (player.xp >= xpForLevel(player.level + 1)) {
      const hpGain = 8 + Math.floor(player.stats.endurance * 0.6)
      const mpGain = 2 + Math.floor(player.stats.intelligence * 0.4)
      player.level  += 1
      player.maxHp  += hpGain
      player.hp      = Math.min(player.hp + hpGain, player.maxHp)
      player.maxMp  += mpGain
      player.mp      = Math.min(player.mp + mpGain, player.maxMp)
      const ptGain   = 3 + (player.level % 5 === 0 ? 1 : 0)
      player.statPoints = (player.statPoints ?? 0) + ptGain
      result.levelsGained++
      result.statPointsGranted += ptGain
    }

    if (result.levelsGained > 0) {
      result.updates[`players/${player.id}/level`]      = player.level
      result.updates[`players/${player.id}/maxHp`]      = player.maxHp
      result.updates[`players/${player.id}/hp`]         = player.hp
      result.updates[`players/${player.id}/maxMp`]      = player.maxMp
      result.updates[`players/${player.id}/mp`]         = player.mp
      result.updates[`players/${player.id}/statPoints`] = player.statPoints
    }
  }

  player.quests = { active, completed }
  setLocalPlayer(player)

  // Broadcast a system chat message for every completed quest
  if (result.completedTitles.length > 0) {
    postQuestChatMessages(player, result.completedTitles)
  }

  return result
}

/**
 * Push a system chat message for each completed quest title.
 * Called automatically by `checkAndAdvanceQuestsLocally`.
 */
function postQuestChatMessages(player: PlayerInstance, titles: string[]): void {
  const room = player.room ?? '0'
  for (const title of titles) {
    void push(ref(db, `chat/${room}`), {
      sender:    player.name,
      x:         player.x,
      y:         player.y,
      text:      `Quest completed: ${title}! 🎉`,
      timestamp: Date.now(),
      system:    true,
    })
  }
}
