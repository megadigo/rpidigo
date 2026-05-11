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
  },
  {
    id: 'iron_bow', name: 'Iron Bow', stackable: false, maxStack: 1,
    spriteFrame: 'iron_bow.png', category: 'weapon',
    power: 11, weaponType: 'ranged', levelRequired: 4, animFrame: 'iron_bow_shoot.png',
  },

  // ── Magic weapons ─────────────────────────────────────────────────────────
  {
    id: 'oak_staff', name: 'Oak Staff', stackable: false, maxStack: 1,
    spriteFrame: 'oak_staff.png', category: 'weapon',
    power: 8, weaponType: 'magic', levelRequired: 2, mpCostPerSwing: 5,
    animFrame: 'oak_staff_cast.png',
  },
  {
    id: 'iron_staff', name: 'Iron Staff', stackable: false, maxStack: 1,
    spriteFrame: 'iron_staff.png', category: 'weapon',
    power: 16, weaponType: 'magic', levelRequired: 5, mpCostPerSwing: 8,
    specialEffect: 'area', animFrame: 'iron_staff_cast.png',
  },
]
