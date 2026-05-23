/**
 * Deterministic seeded PRNG (Mulberry32).
 * Returns a factory that creates a fresh seeded RNG given a numeric seed.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded integer in [min, max] inclusive. */
export function seededRandInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

/** Pick a weighted random entry from a table. Returns the entry id. */
export function weightedRandom<T extends { weight: number }>(
  rand: () => number,
  table: T[],
): T {
  const total = table.reduce((s, e) => s + e.weight, 0)
  let roll = rand() * total
  for (const entry of table) {
    roll -= entry.weight
    if (roll <= 0) return entry
  }
  return table[table.length - 1]
}

/** SHA-256 hex of a string (browser Web Crypto API). */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Tile position key with 4-digit zero-padded coords — e.g. (42, 117) → '0042_0117'. */
export function tileKey(x: number, y: number): string {
  return `${String(x).padStart(4, '0')}_${String(y).padStart(4, '0')}`
}

/** Chunk position key with 2-digit zero-padded coords — e.g. (3, 7) → '03_07'. */
export function chunkKey(cx: number, cy: number): string {
  return `${String(cx).padStart(2, '0')}_${String(cy).padStart(2, '0')}`
}

/** Generate a crypto-random numeric seed. */
export function randomSeed(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]
}

/**
 * Total cumulative XP required to reach `lvl` from level 1.
 * Formula: 50 × lvl² − 50 × lvl
 *   Lv 2 →    100 XP  (~17 wolves at 6 XP each)
 *   Lv 3 →    300 XP
 *   Lv 5 →  1 000 XP
 *   Lv 10 →  4 500 XP
 *   Lv 20 → 19 000 XP
 */
export function xpForLevel(lvl: number): number {
  return 50 * lvl * lvl - 50 * lvl
}
