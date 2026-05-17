/**
 * ScriptExecutor — time-sliced, Pyodide-powered entity AI runner.
 *
 * Design goals (Step 9):
 *  - No entity cap: claims every unclaimed/stale entity in the player's vicinity.
 *  - Oldest first: entities sorted by lastLogicAt ascending so the most
 *    overdue one always runs next.
 *  - Respects per-entity tick intervals (derived from speed: slow/normal/fast).
 *  - Performance-friendly: stops after BUDGET_MS wall-clock milliseconds each
 *    frame; remaining overdue entities are deferred to the next frame.
 *
 * Ownership model:
 *  A player claims an entity by writing its own playerId to
 *  `entities/{col}/{id}/executingPlayerId`. Claims are considered stale when
 *  the entity's lastLogicAt hasn't advanced in CLAIM_TTL_MS — at that point
 *  any other player may reclaim it.  No artificial cap on the number of
 *  entities a single player may hold.
 *
 * Python sandbox API (available globals inside every entity script):
 *   state           str    — current FSM state, read-only; write via set_state()
 *   hp / max_hp     int
 *   x / y           int    — tile position
 *   spawn_x/spawn_y int
 *   memory          dict   — persistent across ticks; write via set_memory()
 *   nearby_players  list[dict{id,name,x,y,level}]
 *
 *   move(dx, dy)          — move one step in (sign(dx), sign(dy)); collision checked
 *   attack(player_id)     — deal power damage to the nearest matching player
 *   set_state(s)          — change FSM state
 *   speak(text)           — emit a chat message in the current room
 *   set_memory(key, val)  — persist a value across ticks
 */
import { ref, onValue, update, query, orderByChild, equalTo } from 'firebase/database'
import { db } from '../firebase.ts'
import { isPassable } from './CollisionMap.ts'
import { getLocalPlayer } from '../player/Auth.ts'
import type { EnemyInstance, NpcInstance } from './types.ts'
import { EnemyRegistry } from '../registry/registries.ts'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max wall-clock ms to spend running scripts per frame. */
const BUDGET_MS = 4

/** Chebyshev tile radius that defines "vicinity" around the local player. */
const VICINITY_RADIUS = 20

/**
 * If an entity's lastLogicAt is older than this, its claim is considered stale
 * and any player in vicinity may reclaim it.
 */
const CLAIM_TTL_MS = 10_000

/** Per-frame entity tick intervals keyed by EnemyDefinition.speed. */
const SPEED_TICK_MS: Record<string, number> = {
  slow:   2_000,
  normal: 1_000,
  fast:     500,
}

// ─── Pyodide singleton ────────────────────────────────────────────────────────

/** Minimal typing for the parts of the Pyodide API we use. */
interface PyodideInterface {
  globals: {
    set(name: string, value: unknown): void
    get(name: string): unknown
  }
  runPython(code: string): unknown
  toPy(obj: unknown): unknown
}

let _pyodide: PyodideInterface | null = null

/** Call once after loadPyodideRuntime() resolves. */
export function setPyodide(py: PyodideInterface): void {
  _pyodide = py
}

/** Returns true when the Pyodide runtime is ready for script execution. */
export function isPyodideReady(): boolean {
  return _pyodide !== null
}

/**
 * Dynamically loads the Pyodide WASM runtime from CDN and registers it.
 * Safe to call multiple times — resolves immediately if already loaded.
 * Never throws; logs a warning on failure so the game continues without AI.
 */
export async function loadPyodideRuntime(): Promise<void> {
  if (_pyodide) return
  try {
    const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
    // The /* @vite-ignore */ comment prevents Vite from attempting to bundle
    // this CDN import — the WASM runtime is always loaded from the network.
    const mod = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`) as {
      loadPyodide(opts: { indexURL: string }): Promise<PyodideInterface>
    }
    const py = await mod.loadPyodide({ indexURL: PYODIDE_CDN })
    setPyodide(py)
    // Pre-import the random module so entity scripts can call random.randint() etc.
    py.runPython('import random')
  } catch (err) {
    console.warn('[ScriptExecutor] Pyodide failed to load — entity AI disabled.', err)
  }
}

// ─── NearbyPlayer ─────────────────────────────────────────────────────────────

/** Shape passed to Python scripts as entries in the `nearby_players` list. */
export interface NearbyPlayer {
  id:    string
  name:  string
  x:     number
  y:     number
  level: number
}

// ─── ScriptExecutor class ─────────────────────────────────────────────────────

export class ScriptExecutor {
  private _room = ''

  /** Full EnemyInstance data for the current room, keyed by entity id. */
  private _enemies = new Map<string, EnemyInstance>()
  /** Full NpcInstance data for the current room, keyed by entity id. */
  private _npcs    = new Map<string, NpcInstance>()

  private _enemyUnsub: (() => void) | null = null
  private _npcUnsub:   (() => void) | null = null

  // ── Room management ────────────────────────────────────────────────────────

  /**
   * Switch to a new room: releases all current claims, unsubscribes old
   * Firebase listeners, and starts fresh subscriptions for the new room.
   */
  setRoom(room: string): void {
    this._releaseAll()
    if (this._enemyUnsub) { this._enemyUnsub(); this._enemyUnsub = null }
    if (this._npcUnsub)   { this._npcUnsub();   this._npcUnsub   = null }

    this._room = room
    this._enemies.clear()
    this._npcs.clear()

    if (!room) return

    // Subscribe to all enemies whose `room` field equals the current room.
    // Requires the ".indexOn": ["room"] rule in database.rules.json.
    this._enemyUnsub = onValue(
      query(ref(db, 'entities/enemies'), orderByChild('room'), equalTo(room)),
      snap => {
        this._enemies.clear()
        const data = snap.val() as Record<string, EnemyInstance> | null
        if (data) for (const [id, e] of Object.entries(data)) this._enemies.set(id, e)
      },
    )

    this._npcUnsub = onValue(
      query(ref(db, 'entities/npcs'), orderByChild('room'), equalTo(room)),
      snap => {
        this._npcs.clear()
        const data = snap.val() as Record<string, NpcInstance> | null
        if (data) for (const [id, n] of Object.entries(data)) this._npcs.set(id, n)
      },
    )
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Process overdue entity scripts for this frame.
   * Called from GameScene.update() every frame.
   *
   * @param playerX    Current player tile X
   * @param playerY    Current player tile Y
   * @param nearbyPlayers  All players (local + remote) visible to scripts
   */
  tick(playerX: number, playerY: number, nearbyPlayers: NearbyPlayer[]): void {
    if (!_pyodide || !this._room) return

    const now       = Date.now()
    const budgetEnd = performance.now() + BUDGET_MS
    const playerId  = getLocalPlayer().id

    // ── Collect all entities in vicinity ──────────────────────────────────
    type WorkItem = {
      kind:   'enemy' | 'npc'
      id:     string
      entity: EnemyInstance | NpcInstance
      tickMs: number
    }
    const overdue: WorkItem[] = []

    for (const [id, e] of this._enemies) {
      if (e.hp <= 0) continue  // skip dead enemies
      if (Math.max(Math.abs(e.x - playerX), Math.abs(e.y - playerY)) > VICINITY_RADIUS) continue

      const tickMs    = this._enemyTickMs(e.templateId)
      const ownedByUs = e.executingPlayerId === playerId
      const free      = e.executingPlayerId === null
      const stale     = !free && !ownedByUs && (now - e.lastLogicAt > CLAIM_TTL_MS)

      // Claim any entity that is free or whose previous owner went offline
      if (free || stale) this._claim('enemies', id, e, playerId)

      if ((ownedByUs || free || stale) && now - e.lastLogicAt >= tickMs) {
        overdue.push({ kind: 'enemy', id, entity: e, tickMs })
      }
    }

    for (const [id, n] of this._npcs) {
      if (Math.max(Math.abs(n.x - playerX), Math.abs(n.y - playerY)) > VICINITY_RADIUS) continue

      // NPCs always use a 1 000 ms tick (no speed field on NpcInstance)
      const ownedByUs = n.executingPlayerId === playerId
      const free      = n.executingPlayerId === null
      const stale     = !free && !ownedByUs && (now - n.lastLogicAt > CLAIM_TTL_MS)

      if (free || stale) this._claim('npcs', id, n, playerId)

      if ((ownedByUs || free || stale) && now - n.lastLogicAt >= 1_000) {
        overdue.push({ kind: 'npc', id, entity: n, tickMs: 1_000 })
      }
    }

    // ── Oldest lastLogicAt first (most overdue runs next) ─────────────────
    overdue.sort((a, b) => a.entity.lastLogicAt - b.entity.lastLogicAt)

    // ── Execute within budget ─────────────────────────────────────────────
    for (const { kind, id, entity } of overdue) {
      if (performance.now() >= budgetEnd) break
      this._runScript(kind, id, entity, now, nearbyPlayers)
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  /** Release all claims and unsubscribe. Call when the scene shuts down. */
  destroy(): void {
    this._releaseAll()
    if (this._enemyUnsub) { this._enemyUnsub(); this._enemyUnsub = null }
    if (this._npcUnsub)   { this._npcUnsub();   this._npcUnsub   = null }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _claim(
    collection: 'enemies' | 'npcs',
    id:         string,
    entity:     EnemyInstance | NpcInstance,
    playerId:   string,
  ): void {
    // Update local cache immediately so the next tick sees the new owner
    // without waiting for the Firebase round-trip.
    entity.executingPlayerId = playerId
    void update(ref(db), { [`entities/${collection}/${id}/executingPlayerId`]: playerId })
  }

  private _releaseAll(): void {
    let playerId: string | null = null
    try { playerId = getLocalPlayer().id } catch { return }

    const rel: Record<string, null> = {}
    for (const [id, e] of this._enemies)
      if (e.executingPlayerId === playerId)
        rel[`entities/enemies/${id}/executingPlayerId`] = null
    for (const [id, n] of this._npcs)
      if (n.executingPlayerId === playerId)
        rel[`entities/npcs/${id}/executingPlayerId`] = null

    if (Object.keys(rel).length > 0) void update(ref(db), rel)
  }

  private _enemyTickMs(templateId: string): number {
    try {
      const def = EnemyRegistry.get(templateId)
      return SPEED_TICK_MS[def.speed] ?? 1_000
    } catch {
      return 1_000
    }
  }

  private _runScript(
    kind:          'enemy' | 'npc',
    id:            string,
    entity:        EnemyInstance | NpcInstance,
    now:           number,
    nearbyPlayers: NearbyPlayer[],
  ): void {
    const py = _pyodide!

    // Actions collected from the script callbacks
    const actions: {
      move?:     [number, number]
      attack?:   string
      setState?: string
      speak?:    string
      memory?:   Record<string, unknown>
    } = {}

    try {
      // ── Inject read-only context ─────────────────────────────────────────
      py.globals.set('state',          entity.state)
      py.globals.set('hp',             entity.hp)
      py.globals.set('max_hp',         entity.maxHp)
      py.globals.set('x',              entity.x)
      py.globals.set('y',              entity.y)
      py.globals.set('spawn_x',        'spawnX' in entity ? (entity as EnemyInstance).spawnX : entity.x)
      py.globals.set('spawn_y',        'spawnY' in entity ? (entity as EnemyInstance).spawnY : entity.y)
      // toPy converts the JS object to a proper Python dict / list
      py.globals.set('memory',         py.toPy(entity.memory ?? {}))
      py.globals.set('nearby_players', py.toPy(nearbyPlayers))

      // ── Inject per-entity attributes ────────────────────────────────────
      let aggroRange = 5
      let power = (entity as EnemyInstance).power ?? 10
      if (kind === 'enemy') {
        try {
          const def = EnemyRegistry.get((entity as EnemyInstance).templateId)
          aggroRange = def.aggroRange
          power = def.basePower
        } catch { /* use defaults */ }
      }
      py.globals.set('aggro_range', aggroRange)
      py.globals.set('power',       power)

      // ── Inject action callbacks ──────────────────────────────────────────
      py.globals.set('move', (dx: number, dy: number) => {
        actions.move = [Number(dx), Number(dy)]
      })
      py.globals.set('attack', (targetId: unknown) => {
        actions.attack = String(targetId)
      })
      py.globals.set('set_state', (s: unknown) => {
        actions.setState = String(s)
      })
      py.globals.set('speak', (text: unknown) => {
        // Clamp chat messages to 120 characters
        actions.speak = String(text).slice(0, 120)
      })
      py.globals.set('set_memory', (key: unknown, val: unknown) => {
        actions.memory ??= {}
        // Only store JSON-serialisable values
        const k = String(key)
        if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean' || val === null) {
          actions.memory[k] = val
        }
      })

      py.runPython(entity.script ?? 'pass')
    } catch (err) {
      console.warn(`[ScriptExecutor] ${kind} "${id}" script error:`, err)
    }

    // ── Apply move action ────────────────────────────────────────────────
    let newX = entity.x
    let newY = entity.y
    if (actions.move) {
      const [dx, dy] = actions.move
      const tx = entity.x + Math.sign(dx)
      const ty = entity.y + Math.sign(dy)
      if (isPassable(tx, ty)) { newX = tx; newY = ty }
    }

    const newState  = actions.setState ?? entity.state
    const newMemory = { ...(entity.memory ?? {}), ...(actions.memory ?? {}) }
    const col       = kind === 'enemy' ? 'enemies' : 'npcs'

    const posChanged   = newX !== entity.x || newY !== entity.y
    const stateChanged = newState !== entity.state
    const hasSpeech    = !!actions.speak
    const hasAttack    = !!actions.attack

    // ── Optimistic local cache update (avoids double-tick this frame) ────
    entity.x           = newX
    entity.y           = newY
    entity.state       = newState
    entity.memory      = newMemory
    entity.lastLogicAt = now

    // ── Write results to Firebase ────────────────────────────────────────
    // If nothing changed and no side-effects, only update the tick timestamp
    // to avoid flooding Firebase with no-op writes.
    if (!posChanged && !stateChanged && !hasSpeech && !hasAttack) {
      void update(ref(db), { [`entities/${col}/${id}/lastLogicAt`]: now })
      return
    }

    const fbUpdate: Record<string, unknown> = {
      [`entities/${col}/${id}/x`]:           newX,
      [`entities/${col}/${id}/y`]:           newY,
      [`entities/${col}/${id}/state`]:       newState,
      [`entities/${col}/${id}/memory`]:      newMemory,
      [`entities/${col}/${id}/lastLogicAt`]: now,
      // Presence mirrors (triggers the rendering subscription in GameScene)
      [`presence/${this._room}/${col}/${id}/x`]:     newX,
      [`presence/${this._room}/${col}/${id}/y`]:     newY,
      [`presence/${this._room}/${col}/${id}/state`]: newState,
    }

    if (kind === 'enemy') {
      fbUpdate[`presence/${this._room}/${col}/${id}/hp`] = entity.hp
    }

    if (hasSpeech) {
      // Emit as a system chat message so HudScene renders it
      fbUpdate[`chat/${this._room}/_ai_${id}_${now}`] = {
        sender:    (entity as EnemyInstance).templateId ?? id,
        x:         newX,
        y:         newY,
        text:      actions.speak,
        timestamp: now,
        system:    true,
      }
    }

    void update(ref(db), fbUpdate)
  }
}
