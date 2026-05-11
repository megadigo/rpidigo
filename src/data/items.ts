import type { ItemDefinition } from '../registry/types'

export const items: ItemDefinition[] = [
  // ── Materials ─────────────────────────────────────────────────────────────
  { id: 'wood',         name: 'Wood',        stackable: true,  maxStack: 99, spriteFrame: 'wood.png',        category: 'material' },
  { id: 'stone',        name: 'Stone',       stackable: true,  maxStack: 99, spriteFrame: 'stone.png',       category: 'material' },
  { id: 'fiber',        name: 'Fiber',       stackable: true,  maxStack: 99, spriteFrame: 'fiber.png',       category: 'material' },
  { id: 'iron_ore',     name: 'Iron Ore',    stackable: true,  maxStack: 99, spriteFrame: 'iron_ore.png',    category: 'material' },
  { id: 'iron_bar',     name: 'Iron Bar',    stackable: true,  maxStack: 99, spriteFrame: 'iron_bar.png',    category: 'material' },
  { id: 'gold_coin',    name: 'Gold Coin',   stackable: true,  maxStack: 9999, spriteFrame: 'gold_coin.png', category: 'material' },
  { id: 'mushroom_item',name: 'Mushroom',    stackable: true,  maxStack: 20, spriteFrame: 'mushroom.png',    category: 'material' },
  { id: 'leather',      name: 'Leather',     stackable: true,  maxStack: 99, spriteFrame: 'leather.png',     category: 'material' },

  // ── Consumables ───────────────────────────────────────────────────────────
  { id: 'health_potion',  name: 'Health Potion',  stackable: true, maxStack: 20, spriteFrame: 'health_potion.png',  category: 'consumable' },
  { id: 'mana_potion',    name: 'Mana Potion',    stackable: true, maxStack: 20, spriteFrame: 'mana_potion.png',    category: 'consumable' },
  { id: 'antidote',       name: 'Antidote',       stackable: true, maxStack: 20, spriteFrame: 'antidote.png',       category: 'consumable' },
  { id: 'cooked_mushroom',name: 'Cooked Mushroom',stackable: true, maxStack: 20, spriteFrame: 'cooked_mushroom.png',category: 'consumable' },

  // ── Tools ─────────────────────────────────────────────────────────────────
  { id: 'axe',    name: 'Woodcutter\'s Axe', stackable: false, maxStack: 1, spriteFrame: 'axe.png',    category: 'tool' },
  { id: 'pickaxe',name: 'Pickaxe',           stackable: false, maxStack: 1, spriteFrame: 'pickaxe.png',category: 'tool' },
  { id: 'scythe', name: 'Scythe',            stackable: false, maxStack: 1, spriteFrame: 'scythe.png', category: 'tool' },

  // ── Keys ──────────────────────────────────────────────────────────────────
  { id: 'dungeon_key', name: 'Dungeon Key', stackable: true, maxStack: 5, spriteFrame: 'dungeon_key.png', category: 'key' },
]
