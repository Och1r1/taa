/** Stable hash/RNG used to build a repeatable challenge from the same content pool. */
export function seededRandom(seed: string): () => number {
  let value = 2166136261
  for (const char of seed) {
    value ^= char.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function dailySeed(dateKey: string, artistSlug: string): string {
  return `taa-daily:${dateKey}:${artistSlug}`
}
