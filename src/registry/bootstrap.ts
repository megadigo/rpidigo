import { get, ref } from 'firebase/database'
import { db } from '../firebase'
import { tiles }   from '../data/tiles'
import { enemies } from '../data/enemies'
import { zones }   from '../data/zones'
import { items }   from '../data/items'
import { weapons } from '../data/weapons'
import { armors }  from '../data/armors'
import { recipes } from '../data/recipes'
import {
  TileRegistry,
  EnemyRegistry,
  ZoneRegistry,
  ItemRegistry,
  WeaponRegistry,
  ArmorRegistry,
  RecipeRegistry,
} from './registries'
import type {
  TileDefinition,
  EnemyDefinition,
  ZoneDefinition,
  ItemDefinition,
  WeaponDefinition,
  ArmorDefinition,
  RecipeDefinition,
} from './types'

interface FirebaseExtensions {
  tiles?:    Record<string, TileDefinition>
  enemies?:  Record<string, EnemyDefinition>
  zones?:    Record<string, ZoneDefinition>
  items?:    Record<string, ItemDefinition>
  weapons?:  Record<string, WeaponDefinition>
  armors?:   Record<string, ArmorDefinition>
  recipes?:  Record<string, RecipeDefinition>
}

function mergeExtensions(ext: FirebaseExtensions): void {
  if (ext.tiles)   Object.values(ext.tiles).forEach(d => TileRegistry.register(d))
  if (ext.enemies) Object.values(ext.enemies).forEach(d => EnemyRegistry.register(d))
  if (ext.zones)   Object.values(ext.zones).forEach(d => ZoneRegistry.register(d))
  if (ext.items)   Object.values(ext.items).forEach(d => ItemRegistry.register(d))
  if (ext.weapons) Object.values(ext.weapons).forEach(d => WeaponRegistry.register(d))
  if (ext.armors)  Object.values(ext.armors).forEach(d => ArmorRegistry.register(d))
  if (ext.recipes) Object.values(ext.recipes).forEach(d => RecipeRegistry.register(d))
}

export async function bootstrapRegistries(): Promise<void> {
  // 1. Load all built-in definitions
  TileRegistry.registerAll(tiles)
  EnemyRegistry.registerAll(enemies)
  ZoneRegistry.registerAll(zones)
  ItemRegistry.registerAll(items)
  WeaponRegistry.registerAll(weapons)
  ArmorRegistry.registerAll(armors)
  RecipeRegistry.registerAll(recipes)

  // 2. Fetch Firebase extensions and merge (overrides or additions)
  const snap = await get(ref(db, 'config/extensions'))
  if (snap.exists()) {
    mergeExtensions(snap.val() as FirebaseExtensions)
  }
}
