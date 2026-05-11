import type { ShopStockEntry } from '../registry/types'

// Base stock loaded into every village shop; ShopManager applies zone multipliers and seed jitter on top.
export const shopStock: ShopStockEntry[] = [
  // ── Consumables ───────────────────────────────────────────────────────────
  { itemId: 'health_potion', baseBuyPrice: 20,  sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'mana_potion',   baseBuyPrice: 25,  sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'antidote',      baseBuyPrice: 15,  sellMultiplier: 0.5, maxQuantity: -1  },

  // ── Materials ─────────────────────────────────────────────────────────────
  { itemId: 'wood',          baseBuyPrice: 5,   sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'stone',         baseBuyPrice: 5,   sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'fiber',         baseBuyPrice: 4,   sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'iron_ore',      baseBuyPrice: 12,  sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'iron_bar',      baseBuyPrice: 30,  sellMultiplier: 0.5, maxQuantity: -1  },
  { itemId: 'leather',       baseBuyPrice: 8,   sellMultiplier: 0.5, maxQuantity: -1  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  { itemId: 'axe',           baseBuyPrice: 40,  sellMultiplier: 0.4, maxQuantity: -1  },
  { itemId: 'pickaxe',       baseBuyPrice: 45,  sellMultiplier: 0.4, maxQuantity: -1  },
  { itemId: 'scythe',        baseBuyPrice: 38,  sellMultiplier: 0.4, maxQuantity: -1  },

  // ── Weapons ───────────────────────────────────────────────────────────────
  { itemId: 'wooden_sword',  baseBuyPrice: 30,  sellMultiplier: 0.4, maxQuantity: -1  },
  { itemId: 'iron_sword',    baseBuyPrice: 120, sellMultiplier: 0.4, maxQuantity: 5   },
  { itemId: 'iron_axe',      baseBuyPrice: 140, sellMultiplier: 0.4, maxQuantity: 5   },
  { itemId: 'wooden_bow',    baseBuyPrice: 35,  sellMultiplier: 0.4, maxQuantity: -1  },
  { itemId: 'iron_bow',      baseBuyPrice: 130, sellMultiplier: 0.4, maxQuantity: 5   },
  { itemId: 'oak_staff',     baseBuyPrice: 50,  sellMultiplier: 0.4, maxQuantity: -1  },
  { itemId: 'iron_staff',    baseBuyPrice: 160, sellMultiplier: 0.4, maxQuantity: 5   },

  // ── Armor ─────────────────────────────────────────────────────────────────
  { itemId: 'leather_helmet',      baseBuyPrice: 35,  sellMultiplier: 0.4, maxQuantity: -1 },
  { itemId: 'leather_chestplate',  baseBuyPrice: 60,  sellMultiplier: 0.4, maxQuantity: -1 },
  { itemId: 'leather_leggings',    baseBuyPrice: 50,  sellMultiplier: 0.4, maxQuantity: -1 },
  { itemId: 'leather_boots',       baseBuyPrice: 35,  sellMultiplier: 0.4, maxQuantity: -1 },
  { itemId: 'leather_gloves',      baseBuyPrice: 25,  sellMultiplier: 0.4, maxQuantity: -1 },
  { itemId: 'iron_helmet',         baseBuyPrice: 100, sellMultiplier: 0.4, maxQuantity: 3  },
  { itemId: 'iron_chestplate',     baseBuyPrice: 180, sellMultiplier: 0.4, maxQuantity: 3  },
  { itemId: 'iron_leggings',       baseBuyPrice: 150, sellMultiplier: 0.4, maxQuantity: 3  },
  { itemId: 'iron_boots',          baseBuyPrice: 100, sellMultiplier: 0.4, maxQuantity: 3  },
  { itemId: 'iron_gloves',         baseBuyPrice: 80,  sellMultiplier: 0.4, maxQuantity: 3  },
]
