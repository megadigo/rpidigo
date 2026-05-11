import type {
  TileDefinition,
  EnemyDefinition,
  ZoneDefinition,
  ItemDefinition,
  WeaponDefinition,
  ArmorDefinition,
  RecipeDefinition,
} from './types'

class Registry<T extends { id: string }> {
  private readonly store = new Map<string, T>()

  register(def: T): void {
    this.store.set(def.id, def)
  }

  registerAll(defs: T[]): void {
    for (const def of defs) this.register(def)
  }

  get(id: string): T {
    const def = this.store.get(id)
    if (!def) throw new Error(`Registry: unknown id "${id}"`)
    return def
  }

  getAll(): T[] {
    return Array.from(this.store.values())
  }

  has(id: string): boolean {
    return this.store.has(id)
  }
}

export const TileRegistry    = new Registry<TileDefinition>()
export const EnemyRegistry   = new Registry<EnemyDefinition>()
export const ZoneRegistry    = new Registry<ZoneDefinition>()
export const ItemRegistry    = new Registry<ItemDefinition>()
export const WeaponRegistry  = new Registry<WeaponDefinition>()
export const ArmorRegistry   = new Registry<ArmorDefinition>()
export const RecipeRegistry  = new Registry<RecipeDefinition>()
