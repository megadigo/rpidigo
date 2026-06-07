/**
 * Single source of truth for how a player's primary stats (STR/DEX/INT/VIT)
 * translate into combat numbers. Used by GameScene combat resolution,
 * InventoryScene's equip flow, Auth registration, and LevelUpScene's preview.
 */
import { WeaponRegistry, ArmorRegistry, RecipeRegistry, ItemRegistry } from '../registry/registries.ts'
import type { PlayerInstance } from './types.ts'

export type PrimaryStats = PlayerInstance['stats']
export type WeaponType   = 'melee' | 'ranged' | 'magic'

const BASE_CRIT_CHANCE = 0.05
const MAX_CRIT_CHANCE  = 0.35
/** Multiplier applied to damage on a critical hit. */
export const CRIT_DAMAGE_MULT = 1.5

export function meleePower(weaponPower: number, str: number): number {
  return weaponPower + str * 2
}
export function rangedPower(weaponPower: number, dex: number): number {
  return weaponPower + dex * 1.8
}
export function magicPower(weaponPower: number, int: number): number {
  return weaponPower + int * 2.2
}
export function defenseValue(armorDefense: number, vit: number): number {
  return armorDefense + vit * 0.8
}
export function critChance(dex: number): number {
  return Math.min(MAX_CRIT_CHANCE, BASE_CRIT_CHANCE + dex * 0.0025)
}

/** Equipped weapon's base power and combat type — bare-handed counts as melee with 0 power. */
export function getEquippedWeapon(player: PlayerInstance): { power: number; type: WeaponType } {
  if (player.equippedWeapon) {
    try {
      const def = WeaponRegistry.get(player.equippedWeapon)
      return { power: def.power, type: def.weaponType }
    } catch { /* unknown weapon id — treat as bare-handed */ }
  }
  return { power: 0, type: 'melee' }
}

/** Sum of the `defense` stat across every equipped armor piece. */
export function getEquippedArmorDefense(player: PlayerInstance): number {
  const slots = player.equippedArmor
  if (!slots) return 0
  let sum = 0
  for (const itemId of Object.values(slots)) {
    if (!itemId) continue
    try { sum += ArmorRegistry.get(itemId).defense } catch { /* unknown armor id */ }
  }
  return sum
}

export interface DerivedCombatStats {
  meleePower:  number
  rangedPower: number
  magicPower:  number
  /** The power value the equipped weapon's type actually uses — what attacks deal. */
  activePower: number
  activeType:  WeaponType
  defense:     number
  critChance:  number
}

/**
 * Compute derived combat numbers for a player's current gear, using either
 * the player's real stats or a hypothetical block (for live allocation previews).
 */
export function deriveCombatStats(player: PlayerInstance, stats: PrimaryStats = player.stats): DerivedCombatStats {
  const weapon = getEquippedWeapon(player)
  const armor  = getEquippedArmorDefense(player)
  const melee  = meleePower(weapon.power, stats.strength)
  const ranged = rangedPower(weapon.power, stats.agility)
  const magic  = magicPower(weapon.power, stats.intelligence)
  const active = weapon.type === 'ranged' ? ranged : weapon.type === 'magic' ? magic : melee
  return {
    meleePower:  Math.round(melee),
    rangedPower: Math.round(ranged),
    magicPower:  Math.round(magic),
    activePower: Math.round(active),
    activeType:  weapon.type,
    defense:     Math.round(defenseValue(armor, stats.endurance)),
    critChance:  critChance(stats.agility),
  }
}

/** Recompute `power`/`totalDefense` from current stats + equipped gear (mutates in place). */
export function applyDerivedCombatStats(player: PlayerInstance): void {
  const derived = deriveCombatStats(player)
  player.power        = derived.activePower
  player.totalDefense = derived.defense
}

/** Roll an attack: applies the attacker's crit chance to their current power. */
export function rollAttackDamage(attacker: PlayerInstance): { damage: number; crit: boolean } {
  const crit = Math.random() < critChance(attacker.stats.agility)
  const base = Math.max(1, attacker.power)
  return { damage: crit ? Math.round(base * CRIT_DAMAGE_MULT) : base, crit }
}

/** Display names of weapons/armors/recipes that newly unlock between two levels (prevLevel exclusive). */
export function findNewUnlocks(prevLevel: number, newLevel: number): string[] {
  const unlocked = (levelRequired: number) => levelRequired > prevLevel && levelRequired <= newLevel
  const names: string[] = []
  for (const def of WeaponRegistry.getAll()) if (unlocked(def.levelRequired)) names.push(def.name)
  for (const def of ArmorRegistry.getAll())  if (unlocked(def.levelRequired)) names.push(def.name)
  for (const def of RecipeRegistry.getAll()) {
    if (!unlocked(def.levelRequired)) continue
    try { names.push(`Recipe: ${ItemRegistry.get(def.produces).name}`) } catch { /* unknown item */ }
  }
  return names
}
