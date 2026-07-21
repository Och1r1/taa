import type { Song } from '../types'
import { buildOptions, pickRandom } from './shuffle'

/** Pick a fresh answer + options for a multiplayer round (host-side). */
export function makeRoundPick(
  pool: Song[],
  usedIds: string[],
): { song: Song; options: ReturnType<typeof buildOptions> } {
  const available = pool.filter((s) => !usedIds.includes(s.id))
  const candidates = available.length > 0 ? available : pool
  const song = pickRandom(candidates)
  return { song, options: buildOptions(song, pool) }
}
