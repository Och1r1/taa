export interface Artist {
  id: string
  name: string
  slug: string
}

/** What kind of media an item is presented as. */
export type MediaType = 'audio' | 'video' | 'image'

/** A data-driven content-category slug, such as `song`, `movie`, or a future game type. */
export type Category = string

/** One selectable category from the public category catalog. */
export interface LeaderboardCategory {
  slug: Category
  name: string
  icon: string
  displayOrder: number
  subtitle: string
  accent: string
  pickerLabel: string
  itemLabel: string
  emptyMessage: string
}

/** A pack (artist / collection) as shown in the home-screen picker. */
export interface ArtistOption {
  id: string
  name: string
  slug: string
  category: Category
  songCount: number
}

/** One playable item: a song, a movie clip, an actor photo, etc. */
export interface Song {
  id: string
  artistId: string
  title: string
  mediaType: MediaType
  /** Fully-resolved public URL to the media file in Supabase Storage. */
  mediaUrl: string
  /** Start/length of the played segment (seconds). Used for audio + video. */
  snippetStart: number
  snippetDuration: number
}

export interface GameConfig {
  rounds: number
  timePerRound: number // seconds
  /** Max points awarded for an instant correct answer. */
  maxPoints: number
}

export interface AnswerOption {
  songId: string
  title: string
}

/** One round's worth of question data. */
export interface Round {
  answer: Song
  options: AnswerOption[]
}

/** How a round ended, for the reveal message and scoring. */
export type RoundOutcome = 'correct' | 'wrong' | 'timeout' | 'skipped'

/** Recorded outcome of a completed round. */
export interface RoundResult {
  roundIndex: number
  answerTitle: string
  pickedTitle: string | null
  correct: boolean
  outcome: RoundOutcome
  hintUsed: boolean
  timeLeft: number
  points: number
}

export type GamePhase = 'idle' | 'loading' | 'playing' | 'revealed' | 'gameover' | 'error'

/** A saved leaderboard entry (Онооны самбар). */
export interface ScoreEntry {
  id: string
  playerName: string
  artistSlug: string
  category: Category
  points: number
  correctCount: number
  rounds: number
  createdAt: string
}
