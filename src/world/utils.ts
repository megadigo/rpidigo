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

/** SHA-256 hex of a string.
 *  Uses the Web Crypto API when available (HTTPS / localhost).
 *  Falls back to a pure-JS implementation so the game works over plain HTTP. */
export async function sha256(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Pure-JS fallback (RFC 6234 / FIPS 180-4)
  return _sha256js(text)
}

function _sha256js(msg: string): string {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]
  const bytes: number[] = []
  for (let i = 0; i < msg.length; i++) {
    const c = msg.charCodeAt(i)
    if (c < 0x80) { bytes.push(c) }
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff)

  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a
  let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19

  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
  const add  = (...ns: number[]) => ns.reduce((a, b) => (a + b) >>> 0, 0)

  for (let i = 0; i < bytes.length; i += 64) {
    const w = new Uint32Array(64)
    for (let j = 0; j < 16; j++)
      w[j] = (bytes[i+j*4]<<24)|(bytes[i+j*4+1]<<16)|(bytes[i+j*4+2]<<8)|bytes[i+j*4+3]
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15],7) ^ rotr(w[j-15],18) ^ (w[j-15]>>>3)
      const s1 = rotr(w[j-2],17) ^ rotr(w[j-2],19)  ^ (w[j-2]>>>10)
      w[j] = add(w[j-16], s0, w[j-7], s1)
    }
    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7]
    for (let j = 0; j < 64; j++) {
      const S1  = rotr(e,6)^rotr(e,11)^rotr(e,25)
      const ch  = (e&f)^(~e&g)
      const t1  = add(h, S1, ch, K[j], w[j])
      const S0  = rotr(a,2)^rotr(a,13)^rotr(a,22)
      const maj = (a&b)^(a&c)^(b&c)
      const t2  = add(S0, maj)
      h=g; g=f; f=e; e=add(d,t1); d=c; c=b; b=a; a=add(t1,t2)
    }
    h0=add(h0,a); h1=add(h1,b); h2=add(h2,c); h3=add(h3,d)
    h4=add(h4,e); h5=add(h5,f); h6=add(h6,g); h7=add(h7,h)
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7]
    .map(n => n.toString(16).padStart(8,'0')).join('')
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
