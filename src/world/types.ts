/** Shared types for world generation and runtime. */

/**
 * Tile at a world position — layered model.
 *
 *  g  (GROUND, required) — terrain/floor; always rendered at depth 0.
 *  m  (MIDDLE, optional) — objects on the ground (trees, walls, furniture…);
 *                          rendered at depth 1; multiple objects allowed.
 *  t  (TOP, optional)    — cover rendered above the player (depth 20); used
 *                          for roof tiles that hide building interiors.
 *  metadata              — runtime mutable data (gold, opened, etc.).
 */
export interface TileData {
  g: string
  m?: string[]
  t?: string
  metadata?: {
    gold?: number
    opened?: boolean
    regenAt?: number
  }
}

export interface PoiEntry {
  id: string       // e.g. 'v_3_4' or 'd_3_4'
  x: number
  y: number
  sectorX: number
  sectorY: number
}

export interface PoiLayout {
  villages: PoiEntry[]
  dungeons: PoiEntry[]
}

export interface EnemyInstance {
  id: string
  templateId: string
  baseType: string
  variant: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  power: number
  room: string
  x: number
  y: number
  spawnRoom: string
  spawnX: number
  spawnY: number
  state: string
  executingPlayerId: string | null
  lastLogicAt: number
  script: string
  memory: Record<string, unknown>
  carriedGold: number
}

export interface NpcInstance {
  id: string
  templateId: string
  baseType: string
  variant: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  power: number
  room: string
  x: number
  y: number
  homeX: number
  homeY: number
  villageId: string
  zoneId: string
  state: string
  executingPlayerId: string | null
  lastLogicAt: number
  script: string
  memory: Record<string, unknown>
}

export interface ChunkData {
  tiles: Record<string, TileData>     // key = `${x}_${y}`
  enemies: EnemyInstance[]
  npcs: NpcInstance[]
}

export interface PlayerInstance {
  id: string
  name: string
  email: string
  passwordHash: string
  championId: string
  level: number
  xp: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  stats: { strength: number; agility: number; intelligence: number; endurance: number }
  power: number
  totalDefense: number
  gold: number
  inventory: { itemId: string; quantity: number; metadata: Record<string, unknown> }[]
  equippedWeapon: string | null
  equippedArmor: { helmet: string | null; chestplate: string | null; leggings: string | null; boots: string | null; gloves: string | null }
  room: string
  x: number
  y: number
  /** Overworld tile position saved when entering a room; used to restore position on re-login. */
  returnX?: number
  returnY?: number
  house: { room: string; x: number; y: number }
  online: boolean
  lastSeen: number
}
