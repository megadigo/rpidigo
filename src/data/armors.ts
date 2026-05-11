import type { ArmorDefinition } from '../registry/types'

export const armors: ArmorDefinition[] = [
  // ── Leather set (level 1) ─────────────────────────────────────────────────
  { id: 'leather_helmet',     name: 'Leather Helmet',     stackable: false, maxStack: 1, spriteFrame: 'leather_helmet.png',     category: 'weapon', armorSlot: 'helmet',     defense: 2, levelRequired: 1 },
  { id: 'leather_chestplate', name: 'Leather Chestplate', stackable: false, maxStack: 1, spriteFrame: 'leather_chestplate.png', category: 'weapon', armorSlot: 'chestplate', defense: 4, levelRequired: 1 },
  { id: 'leather_leggings',   name: 'Leather Leggings',   stackable: false, maxStack: 1, spriteFrame: 'leather_leggings.png',   category: 'weapon', armorSlot: 'leggings',   defense: 3, levelRequired: 1 },
  { id: 'leather_boots',      name: 'Leather Boots',      stackable: false, maxStack: 1, spriteFrame: 'leather_boots.png',      category: 'weapon', armorSlot: 'boots',      defense: 2, levelRequired: 1 },
  { id: 'leather_gloves',     name: 'Leather Gloves',     stackable: false, maxStack: 1, spriteFrame: 'leather_gloves.png',     category: 'weapon', armorSlot: 'gloves',     defense: 1, levelRequired: 1 },

  // ── Iron set (level 4) ────────────────────────────────────────────────────
  { id: 'iron_helmet',     name: 'Iron Helmet',     stackable: false, maxStack: 1, spriteFrame: 'iron_helmet.png',     category: 'weapon', armorSlot: 'helmet',     defense: 5,  levelRequired: 4, agilityMod: -0.05 },
  { id: 'iron_chestplate', name: 'Iron Chestplate', stackable: false, maxStack: 1, spriteFrame: 'iron_chestplate.png', category: 'weapon', armorSlot: 'chestplate', defense: 9,  levelRequired: 4, agilityMod: -0.1  },
  { id: 'iron_leggings',   name: 'Iron Leggings',   stackable: false, maxStack: 1, spriteFrame: 'iron_leggings.png',   category: 'weapon', armorSlot: 'leggings',   defense: 7,  levelRequired: 4, agilityMod: -0.05 },
  { id: 'iron_boots',      name: 'Iron Boots',      stackable: false, maxStack: 1, spriteFrame: 'iron_boots.png',      category: 'weapon', armorSlot: 'boots',      defense: 4,  levelRequired: 4 },
  { id: 'iron_gloves',     name: 'Iron Gloves',     stackable: false, maxStack: 1, spriteFrame: 'iron_gloves.png',     category: 'weapon', armorSlot: 'gloves',     defense: 3,  levelRequired: 4 },

  // ── Shadow set (level 8, special effects) ─────────────────────────────────
  { id: 'shadow_helmet',     name: 'Shadow Helmet',     stackable: false, maxStack: 1, spriteFrame: 'shadow_helmet.png',     category: 'weapon', armorSlot: 'helmet',     defense: 8,  levelRequired: 8,  specialEffect: 'lifesteal' },
  { id: 'shadow_chestplate', name: 'Shadow Chestplate', stackable: false, maxStack: 1, spriteFrame: 'shadow_chestplate.png', category: 'weapon', armorSlot: 'chestplate', defense: 14, levelRequired: 8,  specialEffect: 'lifesteal' },
  { id: 'shadow_leggings',   name: 'Shadow Leggings',   stackable: false, maxStack: 1, spriteFrame: 'shadow_leggings.png',   category: 'weapon', armorSlot: 'leggings',   defense: 11, levelRequired: 8  },
  { id: 'shadow_boots',      name: 'Shadow Boots',      stackable: false, maxStack: 1, spriteFrame: 'shadow_boots.png',      category: 'weapon', armorSlot: 'boots',      defense: 7,  levelRequired: 8,  specialEffect: 'speed_boost' },
  { id: 'shadow_gloves',     name: 'Shadow Gloves',     stackable: false, maxStack: 1, spriteFrame: 'shadow_gloves.png',     category: 'weapon', armorSlot: 'gloves',     defense: 5,  levelRequired: 8,  specialEffect: 'power_bonus' },
]
