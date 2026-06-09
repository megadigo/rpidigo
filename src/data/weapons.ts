import type { WeaponDefinition } from '../registry/types'

export const weapons: WeaponDefinition[] = [
  // ── Melee weapons ─────────────────────────────────────────────────────────
  {
    id: 'wooden_sword', name: 'Wooden Sword', stackable: false, maxStack: 1,
    spriteFrame: 'wooden_sword.png', category: 'weapon',
    power: 4, weaponType: 'melee', levelRequired: 1, animFrame: 'wooden_sword_swing.png',
  },
  {
    id: 'iron_sword', name: 'Iron Sword', stackable: false, maxStack: 1,
    spriteFrame: 'iron_sword.png', category: 'weapon',
    power: 10, weaponType: 'melee', levelRequired: 3, animFrame: 'iron_sword_swing.png',
  },
  {
    id: 'iron_axe', name: 'Iron Axe', stackable: false, maxStack: 1,
    spriteFrame: 'iron_axe.png', category: 'weapon',
    power: 12, weaponType: 'melee', levelRequired: 4, animFrame: 'iron_axe_swing.png',
  },
  {
    id: 'shadow_blade', name: 'Shadow Blade', stackable: false, maxStack: 1,
    spriteFrame: 'shadow_blade.png', category: 'weapon',
    power: 22, weaponType: 'melee', levelRequired: 8,
    specialEffect: 'lifesteal', animFrame: 'shadow_blade_swing.png',
  },

  // ── Ranged weapons ────────────────────────────────────────────────────────
  {
    id: 'wooden_bow', name: 'Wooden Bow', stackable: false, maxStack: 1,
    spriteFrame: 'wooden_bow.png', category: 'weapon',
    power: 5, weaponType: 'ranged', levelRequired: 1, animFrame: 'wooden_bow_shoot.png',
    projectileSpeed: 140, projectileRange: 7, cooldownMs: 700,
    projectileSprite: 'arrow',
  },
  {
    id: 'iron_bow', name: 'Iron Bow', stackable: false, maxStack: 1,
    spriteFrame: 'iron_bow.png', category: 'weapon',
    power: 11, weaponType: 'ranged', levelRequired: 4, animFrame: 'iron_bow_shoot.png',
    projectileSpeed: 170, projectileRange: 10, cooldownMs: 600,
    projectileSprite: 'arrow',
  },
  {
    id: 'dark_bow', name: 'Dark Bow', stackable: false, maxStack: 1,
    spriteFrame: 'dark_bow.png', category: 'weapon',
    power: 22, weaponType: 'ranged', levelRequired: 8, animFrame: 'dark_bow_shoot.png',
    projectileSpeed: 200, projectileRange: 12, cooldownMs: 550,
    specialEffect: 'pierce',
    projectileSprite: 'dark_arrow',
  },

  // ── Magic weapons — base ──────────────────────────────────────────────────
  {
    id: 'oak_staff', name: 'Oak Staff', stackable: false, maxStack: 1,
    spriteFrame: 'oak_staff.png', category: 'weapon',
    power: 8, weaponType: 'magic', levelRequired: 2, mpCostPerSwing: 5,
    animFrame: 'oak_staff_cast.png',
    projectileSpeed: 120, projectileRange: 6,
    projectileSprite: 'magic_orb',
  },
  {
    id: 'iron_staff', name: 'Iron Staff', stackable: false, maxStack: 1,
    spriteFrame: 'iron_staff.png', category: 'weapon',
    power: 16, weaponType: 'magic', levelRequired: 5, mpCostPerSwing: 8,
    specialEffect: 'area', animFrame: 'iron_staff_cast.png',
    projectileSpeed: 130, projectileRange: 8,
    projectileSprite: 'magic_orb',
  },

  // ── Magic weapons — elemental ─────────────────────────────────────────────
  {
    id: 'air_wand', name: 'Air Wand', stackable: false, maxStack: 1,
    spriteFrame: 'air_wand.png', category: 'weapon',
    power: 7, weaponType: 'magic', levelRequired: 2, mpCostPerSwing: 5,
    animFrame: 'air_wand_cast.png',
    projectileSpeed: 220, projectileRange: 9,
    element: 'air',
    statusEffect: { type: 'chain', durationMs: 0, value: 0 },
    cooldownMs: 550,
    projectileSprite: 'air_gust',
  },
  {
    id: 'fire_wand', name: 'Fire Wand', stackable: false, maxStack: 1,
    spriteFrame: 'fire_wand.png', category: 'weapon',
    power: 10, weaponType: 'magic', levelRequired: 3, mpCostPerSwing: 8,
    animFrame: 'fire_wand_cast.png',
    projectileSpeed: 140, projectileRange: 7,
    element: 'fire',
    statusEffect: { type: 'burn', durationMs: 3000, value: 0.33 },
    cooldownMs: 600,
    projectileSprite: 'fire_ball',
  },
  {
    id: 'water_staff', name: 'Water Staff', stackable: false, maxStack: 1,
    spriteFrame: 'water_staff.png', category: 'weapon',
    power: 9, weaponType: 'magic', levelRequired: 3, mpCostPerSwing: 7,
    animFrame: 'water_staff_cast.png',
    projectileSpeed: 130, projectileRange: 8,
    element: 'water',
    statusEffect: { type: 'slow', durationMs: 2000, value: 0.25 },
    cooldownMs: 600,
    projectileSprite: 'water_orb',
  },
  {
    id: 'earth_staff', name: 'Earth Staff', stackable: false, maxStack: 1,
    spriteFrame: 'earth_staff.png', category: 'weapon',
    power: 12, weaponType: 'magic', levelRequired: 4, mpCostPerSwing: 9,
    animFrame: 'earth_staff_cast.png',
    projectileSpeed: 110, projectileRange: 6,
    element: 'earth',
    statusEffect: { type: 'stagger', durationMs: 1000, value: 0.3 },
    cooldownMs: 650,
    projectileSprite: 'earth_chunk',
  },
  {
    id: 'soul_staff', name: 'Soul Staff', stackable: false, maxStack: 1,
    spriteFrame: 'soul_staff.png', category: 'weapon',
    power: 24, weaponType: 'magic', levelRequired: 10, mpCostPerSwing: 15,
    specialEffect: 'area', animFrame: 'soul_staff_cast.png',
    projectileSpeed: 150, projectileRange: 10,
    element: 'fire',
    statusEffect: { type: 'burn', durationMs: 5000, value: 0.5 },
    cooldownMs: 700,
    projectileSprite: 'fire_ball',
  },
]
