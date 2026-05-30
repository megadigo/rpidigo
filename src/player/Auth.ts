/**
 * Auth — registration and login using Firebase Realtime Database.
 * Passwords are stored as SHA-256 hashes (Web Crypto API).
 */
import { db } from '../firebase.ts'
import { ref, get, set, update, query, orderByChild, equalTo, onDisconnect, serverTimestamp } from 'firebase/database'
import type { PlayerInstance } from '../world/types.ts'
import { sha256 } from '../world/utils.ts'
import { ensureWorldReady } from '../world/WorldBootstrap.ts'
import { isPassable } from '../world/CollisionMap.ts'
import { ensureChunk, setTile } from '../world/ChunkManager.ts'
import { CHUNK_SIZE } from '../world/ChunkGen.ts'
import { generateHouseRoom } from '../world/HouseGen.ts'
import type { TileData } from '../world/types.ts'

let _localPlayer: PlayerInstance | null = null

export function getLocalPlayer(): PlayerInstance {
  if (!_localPlayer) throw new Error('Not logged in')
  return _localPlayer
}

export function setLocalPlayer(p: PlayerInstance): void {
  _localPlayer = p
}

/** Register a new account. Throws if name already taken. */
export async function register(
  name: string,
  email: string,
  password: string,
  championId: string,
): Promise<PlayerInstance> {
  await ensureWorldReady()

  const hash = await sha256(password)
  const id = `player_${Date.now()}_${Math.floor(Math.random() * 0xffff).toString(16)}`

  // Check name uniqueness
  const nameQ = query(ref(db, 'players'), orderByChild('name'), equalTo(name))
  const existing = await get(nameQ)
  if (existing.exists()) throw new Error('Name already taken.')

  // Find a passable spawn point
  const { x, y } = await findSpawnPoint()

  // Place house tile near spawn
  const housePos = findHousePosition(x, y)

  const player: PlayerInstance = {
    id, name, email,
    passwordHash: hash,
    championId,
    level: 1, xp: 0,
    hp: 100, maxHp: 100,
    mp: 50, maxMp: 50,
    stats: { strength: 5, agility: 5, intelligence: 5, endurance: 5 },
    power: 10, totalDefense: 2,
    gold: 0,
    inventory: [],
    equippedWeapon: null,
    equippedArmor: { helmet: null, chestplate: null, leggings: null, boots: null, gloves: null },
    room: '0', x, y,
    house: { room: '0', x: housePos.x, y: housePos.y },
    online: true,
    lastSeen: 0,
  }

  // Ensure the chunk is generated before placing the house tile so that
  // chunk generation cannot overwrite it afterwards.
  await ensureChunk(Math.floor(housePos.x / CHUNK_SIZE), Math.floor(housePos.y / CHUNK_SIZE))
  const houseTile: TileData = { g: 'grass', m: ['house_hut'] }
  await set(ref(db, `map/0/${housePos.x}_${housePos.y}`), houseTile)
  setTile(housePos.x, housePos.y, houseTile)

  // Generate and persist the personal house interior (workbench + storage chest)
  const houseRoom = generateHouseRoom(housePos.x, housePos.y, housePos.x * 73856093 ^ housePos.y * 19349663, 'player_house')
  const roomTiles: Record<string, unknown> = {}
  for (const [k, t] of houseRoom.tiles) roomTiles[`map/${houseRoom.roomId}/${k}`] = JSON.parse(JSON.stringify(t))
  if (Object.keys(roomTiles).length) await update(ref(db), roomTiles)

  // Write player
  await set(ref(db, `players/${id}`), player)

  // Write presence
  await set(ref(db, `presence/0/players/${id}`), {
    x, y, name, level: 1,
    spriteFrame: `${championId}.png`,
    state: 'idle',
  })

  // Clean up presence on disconnect
  const presRef = ref(db, `presence/0/players/${id}`)
  onDisconnect(presRef).remove()
  onDisconnect(ref(db, `players/${id}/online`)).set(false)
  onDisconnect(ref(db, `players/${id}/lastSeen`)).set(serverTimestamp())

  _localPlayer = player
  return player
}

/** Login with existing credentials. Throws on invalid credentials. */
export async function login(name: string, password: string): Promise<PlayerInstance> {
  const hash = await sha256(password)
  const nameQ = query(ref(db, 'players'), orderByChild('name'), equalTo(name))
  const snap = await get(nameQ)
  if (!snap.exists()) throw new Error('Player not found.')

  let found: PlayerInstance | null = null
  snap.forEach(child => {
    const p = child.val() as PlayerInstance
    if (p.passwordHash === hash) found = p
  })
  if (!found) throw new Error('Incorrect password.')

  const player = found as PlayerInstance

  // Mark online
  await set(ref(db, `players/${player.id}/online`), true)
  await set(ref(db, `presence/0/players/${player.id}`), {
    x: player.x, y: player.y,
    name: player.name, level: player.level,
    spriteFrame: `${player.championId}.png`,
    state: 'idle',
  })

  const presRef = ref(db, `presence/0/players/${player.id}`)
  onDisconnect(presRef).remove()
  onDisconnect(ref(db, `players/${player.id}/online`)).set(false)
  onDisconnect(ref(db, `players/${player.id}/lastSeen`)).set(serverTimestamp())

  _localPlayer = player
  return player
}

async function findSpawnPoint(): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = 50 + Math.floor(Math.random() * 900)
    const y = 50 + Math.floor(Math.random() * 900)
    if (isPassable(x, y)) return { x, y }
  }
  // Fallback — guaranteed grass area near centre
  return { x: 500, y: 500 }
}

function findHousePosition(spawnX: number, spawnY: number): { x: number; y: number } {
  for (let r = 1; r <= 5; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const hx = spawnX + dx
        const hy = spawnY + dy
        if (isPassable(hx, hy)) return { x: hx, y: hy }
      }
    }
  }
  return { x: spawnX + 1, y: spawnY }
}
