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

/** Generate a crypto-random numeric seed. */
export function randomSeed(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]
}
