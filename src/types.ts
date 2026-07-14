export interface Artist {
  id: string
  name: string
  slug: string
}

/** An artist as shown in the home-screen picker, with how many songs it has. */
export interface ArtistOption {
  id: string
  name: string
  slug: string
  songCount: number
}

export interface Song {
  id: string
  artistId: string
  title: string
  /** Fully-resolved public URL to the audio file in Supabase Storage. */
  audioUrl: string
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
  points: number
  correctCount: number
  rounds: number
  createdAt: string
}
