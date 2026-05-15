import type { RecipeDefinition } from '../registry/types'

export const recipes: RecipeDefinition[] = [
  // ── Workbench recipes ─────────────────────────────────────────────────────
  { id: 'recipe_wooden_sword',  produces: 'wooden_sword',  quantity: 1, requires: [{ itemId: 'wood', qty: 3 }],                                            station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_wooden_bow',    produces: 'wooden_bow',    quantity: 1, requires: [{ itemId: 'wood', qty: 4 }, { itemId: 'fiber', qty: 2 }],                station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_oak_staff',     produces: 'oak_staff',     quantity: 1, requires: [{ itemId: 'wood', qty: 5 }],                                            station: 'workbench',       levelRequired: 2 },
  { id: 'recipe_leather_helmet',     produces: 'leather_helmet',     quantity: 1, requires: [{ itemId: 'leather', qty: 3 }],                               station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_leather_chestplate', produces: 'leather_chestplate', quantity: 1, requires: [{ itemId: 'leather', qty: 6 }],                               station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_leather_leggings',   produces: 'leather_leggings',   quantity: 1, requires: [{ itemId: 'leather', qty: 5 }],                               station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_leather_boots',      produces: 'leather_boots',      quantity: 1, requires: [{ itemId: 'leather', qty: 3 }],                               station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_leather_gloves',     produces: 'leather_gloves',     quantity: 1, requires: [{ itemId: 'leather', qty: 2 }],                               station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_health_potion',      produces: 'health_potion',      quantity: 2, requires: [{ itemId: 'mushroom_item', qty: 2 }, { itemId: 'fiber', qty: 1 }], station: 'workbench',  levelRequired: 1 },
  { id: 'recipe_cooked_mushroom',    produces: 'cooked_mushroom',    quantity: 1, requires: [{ itemId: 'mushroom_item', qty: 1 }],                         station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_axe',      produces: 'axe',       quantity: 1, requires: [{ itemId: 'wood', qty: 2 }, { itemId: 'stone', qty: 3 }],                        station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_pickaxe',  produces: 'pickaxe',   quantity: 1, requires: [{ itemId: 'wood', qty: 2 }, { itemId: 'stone', qty: 4 }],                        station: 'workbench',       levelRequired: 1 },
  { id: 'recipe_scythe',   produces: 'scythe',    quantity: 1, requires: [{ itemId: 'wood', qty: 3 }, { itemId: 'stone', qty: 2 }],                        station: 'workbench',       levelRequired: 1 },

  // ── Blacksmith forge recipes ──────────────────────────────────────────────
  { id: 'recipe_iron_bar',       produces: 'iron_bar',      quantity: 1, requires: [{ itemId: 'iron_ore', qty: 3 }],                                       station: 'workshop', levelRequired: 3 },
  { id: 'recipe_iron_sword',     produces: 'iron_sword',    quantity: 1, requires: [{ itemId: 'iron_bar', qty: 3 }, { itemId: 'wood', qty: 1 }],            station: 'workshop', levelRequired: 3 },
  { id: 'recipe_iron_axe',       produces: 'iron_axe',      quantity: 1, requires: [{ itemId: 'iron_bar', qty: 3 }, { itemId: 'wood', qty: 2 }],            station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_bow',       produces: 'iron_bow',      quantity: 1, requires: [{ itemId: 'iron_bar', qty: 2 }, { itemId: 'wood', qty: 3 }, { itemId: 'fiber', qty: 2 }], station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_staff',     produces: 'iron_staff',    quantity: 1, requires: [{ itemId: 'iron_bar', qty: 2 }, { itemId: 'wood', qty: 4 }],            station: 'workshop', levelRequired: 5 },
  { id: 'recipe_iron_helmet',    produces: 'iron_helmet',   quantity: 1, requires: [{ itemId: 'iron_bar', qty: 3 }],                                       station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_chestplate',produces: 'iron_chestplate',quantity: 1,requires: [{ itemId: 'iron_bar', qty: 6 }],                                       station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_leggings',  produces: 'iron_leggings', quantity: 1, requires: [{ itemId: 'iron_bar', qty: 5 }],                                       station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_boots',     produces: 'iron_boots',    quantity: 1, requires: [{ itemId: 'iron_bar', qty: 3 }],                                       station: 'workshop', levelRequired: 4 },
  { id: 'recipe_iron_gloves',    produces: 'iron_gloves',   quantity: 1, requires: [{ itemId: 'iron_bar', qty: 2 }],                                       station: 'workshop', levelRequired: 4 },

  // ── Dungeon altar recipes ─────────────────────────────────────────────────
  { id: 'recipe_shadow_blade',      produces: 'shadow_blade',      quantity: 1, requires: [{ itemId: 'iron_bar', qty: 5 }, { itemId: 'gold_coin', qty: 50 }], station: 'dungeon_altar', levelRequired: 8 },
  { id: 'recipe_shadow_helmet',     produces: 'shadow_helmet',     quantity: 1, requires: [{ itemId: 'iron_bar', qty: 4 }, { itemId: 'gold_coin', qty: 30 }], station: 'dungeon_altar', levelRequired: 8 },
  { id: 'recipe_shadow_chestplate', produces: 'shadow_chestplate', quantity: 1, requires: [{ itemId: 'iron_bar', qty: 7 }, { itemId: 'gold_coin', qty: 50 }], station: 'dungeon_altar', levelRequired: 8 },
  { id: 'recipe_shadow_leggings',   produces: 'shadow_leggings',   quantity: 1, requires: [{ itemId: 'iron_bar', qty: 6 }, { itemId: 'gold_coin', qty: 40 }], station: 'dungeon_altar', levelRequired: 8 },
  { id: 'recipe_shadow_boots',      produces: 'shadow_boots',      quantity: 1, requires: [{ itemId: 'iron_bar', qty: 4 }, { itemId: 'gold_coin', qty: 35 }], station: 'dungeon_altar', levelRequired: 8 },
  { id: 'recipe_shadow_gloves',     produces: 'shadow_gloves',     quantity: 1, requires: [{ itemId: 'iron_bar', qty: 3 }, { itemId: 'gold_coin', qty: 25 }], station: 'dungeon_altar', levelRequired: 8 },
]
