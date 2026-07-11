export interface Artist {
  id: string
  name: string
  slug: string
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

/** Recorded outcome of a completed round. */
export interface RoundResult {
  roundIndex: number
  answerTitle: string
  pickedTitle: string | null
  correct: boolean
  timeLeft: number
  points: number
}

export type GamePhase = 'idle' | 'loading' | 'playing' | 'revealed' | 'gameover' | 'error'
