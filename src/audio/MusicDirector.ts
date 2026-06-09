/**
 * MusicDirector — adaptive background music with shuffle-bag playlist selection
 * and crossfade transitions.
 *
 * Playlists:
 *   world_ambient        — overworld exploration, low threat
 *   world_action         — overworld combat pressure (threat score ≥ 6)
 *   dungeon_dark_ambient — any dungeon room, regardless of threat
 *
 * Crossfade: 2.5 s fade-out + 2.5 s fade-in on playlist switch.
 * Dwell: a playlist that has been playing for < 15 s cannot be replaced.
 * Shuffle bag: tracks within a playlist are never repeated until all have played.
 *
 * Settings (volume, enabled) are persisted to localStorage and communicated
 * via game.events so HudScene can drive them without a direct reference.
 */
import Phaser from 'phaser'

export type PlaylistId = 'world_ambient' | 'world_action' | 'dungeon_dark_ambient'

const CROSSFADE_MS = 2_500
const DWELL_MS     = 15_000
const VOL_KEY      = 'rpidigo.music.volume'
const ON_KEY       = 'rpidigo.music.enabled'

const PLAYLISTS: Record<PlaylistId, string[]> = {
  world_ambient:        ['music_ambient_1', 'music_ambient_2', 'music_ambient_3'],
  world_action:         ['music_action_1',  'music_action_2',  'music_action_3'],
  dungeon_dark_ambient: ['music_dark_1',    'music_dark_2',    'music_dark_3'],
}

interface SoundWithVolume extends Phaser.Sound.BaseSound {
  volume: number
  setVolume(value: number): this
}

export class MusicDirector {
  private readonly _scene: Phaser.Scene
  private _playlist: PlaylistId | null = null
  private _sound: SoundWithVolume | null = null
  private _bags: Record<PlaylistId, string[]> = {
    world_ambient: [], world_action: [], dungeon_dark_ambient: [],
  }
  private _lastSwitch = 0
  private _volume: number
  private _enabled: boolean

  constructor(scene: Phaser.Scene) {
    this._scene   = scene
    this._volume  = parseFloat(localStorage.getItem(VOL_KEY) ?? '0.5')
    this._enabled = (localStorage.getItem(ON_KEY) ?? 'true') === 'true'

    scene.game.events.on('musicVolume',  (v: number)  => this.setVolume(v),  this)
    scene.game.events.on('musicEnabled', (on: boolean) => this.setEnabled(on), this)
  }

  get volume()  { return this._volume }
  get enabled() { return this._enabled }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v))
    localStorage.setItem(VOL_KEY, String(this._volume))
    if (this._sound && this._enabled) this._sound.setVolume(this._volume)
  }

  setEnabled(on: boolean): void {
    this._enabled = on
    localStorage.setItem(ON_KEY, String(on))
    if (!on) {
      this._fadeOut(this._sound)
      this._sound = null
    } else if (this._playlist) {
      this._crossfadeTo(this._playlist)
    }
  }

  /**
   * Switch to the given playlist.
   * @param force - bypass the 15 s dwell guard (use for explicit room transitions)
   */
  requestPlaylist(id: PlaylistId, force = false): void {
    if (id === this._playlist) return
    const now = Date.now()
    if (!force && this._sound?.isPlaying && now - this._lastSwitch < DWELL_MS) return
    this._playlist   = id
    this._lastSwitch = now
    if (this._enabled) this._crossfadeTo(id)
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _pick(id: PlaylistId): string {
    if (!this._bags[id].length) {
      // Refill and shuffle the bag
      this._bags[id] = [...PLAYLISTS[id]].sort(() => Math.random() - 0.5)
    }
    return this._bags[id].pop()!
  }

  private _crossfadeTo(id: PlaylistId): void {
    const old = this._sound
    const key = this._pick(id)

    const next = this._scene.sound.add(key, { volume: 0, loop: false }) as SoundWithVolume
    next.play()
    this._sound = next

    this._scene.tweens.add({ targets: next, volume: this._volume, duration: CROSSFADE_MS })
    if (old) this._fadeOut(old)

    // When this track ends, start the next one in the same playlist
    next.once('complete', () => {
      if (this._playlist === id && this._enabled && this._sound === next) {
        this._crossfadeTo(id)
      }
    })
  }

  private _fadeOut(snd: SoundWithVolume | null): void {
    if (!snd) return
    this._scene.tweens.add({
      targets: snd,
      volume: 0,
      duration: CROSSFADE_MS,
      onComplete: () => { try { snd.destroy() } catch { /* already gone */ } },
    })
  }

  destroy(): void {
    this._scene.game.events.off('musicVolume',  undefined, this)
    this._scene.game.events.off('musicEnabled', undefined, this)
    this._fadeOut(this._sound)
    this._sound = null
  }
}
