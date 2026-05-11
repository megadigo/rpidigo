export interface DropEntry {
  itemId: string
  min: number
  max: number
  chance: number   // 0–1
}

export interface TileDefinition {
  id: string
  passable: boolean
  speedMod: number            // 1.0 = normal, 0.5 = slow, 0 = blocked
  destructible: boolean
  gatherAction?: 'chop' | 'mine' | 'cut' | 'pick'
  dropTable?: DropEntry[]
  becomesOnGather?: string    // tile id after gathering
  regenSeconds?: number
  spriteFrame: string         // frame name in tileset sprite sheet
  ambientSound?: string
}

export interface EnemyDefinition {
  id: string            // format: '{baseType}_{variant}'  e.g. 'wolf_aggressive'
  baseType: string      // species name  e.g. 'wolf'
  variant: string       // profile label e.g. 'weak', 'aggressive', 'boss'
  displayName: string
  baseHp: number
  basePower: number
  baseMp: number
  aggroRange: number
  speed: 'slow' | 'normal' | 'fast'
  levelRange: [number, number]
  lootTable: DropEntry[]
  behaviorScript: string
  spriteFrame: string         // filename in public/assets/sprites/entities/enemies/
  special?: string[]
  stealGold?: [number, number]
}

export interface ZoneDefinition {
  id: string
  elevationRange: [number, number]
  moistureRange: [number, number]
  tileProbabilities: Record<string, number>
  spawnTable: { id: string; weight: number; levelRange?: [number, number] }[]
  ambientSound: string
  musicTrack: string
}

export interface ItemDefinition {
  id: string
  name: string
  stackable: boolean
  maxStack: number
  spriteFrame: string
  category: 'material' | 'weapon' | 'consumable' | 'tool' | 'key'
}

export interface WeaponDefinition extends ItemDefinition {
  power: number
  weaponType: 'melee' | 'ranged' | 'magic'
  levelRequired: number
  specialEffect?: string
  mpCostPerSwing?: number
  animFrame: string
}

export interface ArmorDefinition extends ItemDefinition {
  armorSlot: 'helmet' | 'chestplate' | 'leggings' | 'boots' | 'gloves'
  defense: number
  levelRequired: number
  specialEffect?: string
  agilityMod?: number
}

export interface ShopStockEntry {
  itemId: string
  baseBuyPrice: number
  sellMultiplier: number
  maxQuantity: number     // -1 = unlimited
}

export interface RecipeDefinition {
  id: string
  produces: string
  quantity: number
  requires: { itemId: string; qty: number }[]
  station: 'workbench' | 'blacksmith_forge' | 'dungeon_altar'
  levelRequired: number
}
