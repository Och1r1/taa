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
  /** Storage object path inside the public media bucket. */
  mediaPath: string
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
  /** Solo games default to solo; multiplayer exports use multi. */
  mode: 'solo' | 'multi'
}

/** Lobby / in-progress multiplayer room status. */
export type RoomStatus = 'lobby' | 'countdown' | 'playing' | 'revealing' | 'finished' | 'closed'

export type RoomVisibility = 'public' | 'private'

export type RoomPlayerRole = 'player' | 'spectator'

export type RematchStatus = 'pending' | 'completed' | 'cancelled'

/** Public lobby row from list_public_lobbies (joinable via PIN). */
export interface PublicLobbyEntry {
  id: string
  pin: string
  artistSlug: string
  category: Category
  rounds: number
  timePerRound: number
  playerCount: number
  createdAt: string
}

/** Public room row synced via Realtime and REST. */
export interface GameRoom {
  id: string
  pin: string
  status: RoomStatus
  hostPlayerId: string | null
  artistSlug: string
  category: Category
  rounds: number
  timePerRound: number
  maxPoints: number
  currentRoundIndex: number
  createdAt: string
  expiresAt: string
  /** When status is countdown, clients count down to this timestamp. */
  countdownEndsAt: string | null
  visibility: RoomVisibility
  /** Present for private rooms when the host (or invite peek) knows the secret. */
  inviteSecret: string | null
  rematchRoomId: string | null
  rematchDeadline: string | null
  rematchStatus: RematchStatus | null
}

/** One player seated in a multiplayer room. */
export interface RoomPlayer {
  id: string
  roomId: string
  nickname: string
  isHost: boolean
  role: RoomPlayerRole
  score: number
  correctCount: number
  joinedAt: string
  lastSeen: string
  team: 1 | 2 | null
}

/** Local session after create/join — persisted in sessionStorage for refresh. */
export interface MultiSession {
  roomId: string
  pin: string
  playerId: string
  nickname: string
  isHost: boolean
  role: RoomPlayerRole
  /** Private-room invite for lobby QR / rejoin. */
  inviteSecret: string | null
}

/** One option row stored on a multiplayer round (DB snake_case mapped in API). */
export interface RoomRoundOption {
  songId: string
  title: string
}

/** Synced multiplayer round published by the host. */
export interface RoomRound {
  id: string
  roomId: string
  roundIndex: number
  answerSongId: string
  answerTitle: string
  options: RoomRoundOption[]
  mediaType: MediaType
  mediaPath: string
  mediaUrl: string
  snippetStart: number
  snippetDuration: number
  status: 'active' | 'revealed'
  startedAt: string
  endsAt: string
}

/** One player's answer for a multiplayer round. */
export interface RoomAnswer {
  id: string
  roomId: string
  roundIndex: number
  playerId: string
  pickedSongId: string | null
  answeredAt: string
  points: number
  outcome: RoundOutcome
}
