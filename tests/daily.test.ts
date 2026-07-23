import { describe, expect, it } from 'vitest'
import { dailySeed, seededRandom } from '../src/game/daily'
import { buildOptions, pickRandom } from '../src/game/shuffle'
import type { Song } from '../src/types'

const songs: Song[] = Array.from({ length: 5 }, (_, index) => ({
  id: String(index + 1),
  artistId: 'artist',
  title: `Дуу ${index + 1}`,
  mediaType: 'audio',
  mediaPath: '',
  mediaUrl: '',
  snippetStart: 0,
  snippetDuration: 15,
}))

describe('daily challenge seed', () => {
  it('repeats the same random sequence for the same challenge', () => {
    const seed = dailySeed('2026-07-23', 'vandebo')
    const first = seededRandom(seed)
    const second = seededRandom(seed)
    expect([first(), first(), first()]).toEqual([second(), second(), second()])
  })

  it('builds the same answer and options from a seeded source', () => {
    const firstRandom = seededRandom('challenge')
    const secondRandom = seededRandom('challenge')
    const firstAnswer = pickRandom(songs, firstRandom)
    const secondAnswer = pickRandom(songs, secondRandom)
    expect(firstAnswer.id).toBe(secondAnswer.id)
    expect(buildOptions(firstAnswer, songs, firstRandom)).toEqual(buildOptions(secondAnswer, songs, secondRandom))
  })
})
