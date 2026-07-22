import { ensureAnonymousUser } from './auth'
import { supabase } from '../lib/supabase'
import { resolveMediaUrl } from './songs'
import type {
  Category,
  GameConfig,
  GameRoom,
  MediaType,
  MultiSession,
  RoomAnswer,
  RoomPlayer,
  RoomPlayerRole,
  RoomRound,
  RoomRoundOption,
  RoomStatus,
  RoomVisibility,
  RoundOutcome,
  Song,
} from '../types'

interface RoomRow {
  id: string
  pin: string
  status: RoomStatus
  host_player_id: string | null
  artist_slug: string
  category: string
  rounds: number
  time_per_round: number
  max_points: number
  current_round_index: number
  created_at: string
  expires_at: string
  countdown_ends_at?: string | null
  visibility?: RoomVisibility | null
  invite_secret?: string | null
}

interface PlayerRow {
  id: string
  room_id: string
  nickname: string
  is_host: boolean
  role?: RoomPlayerRole | null
  score: number
  correct_count: number
  joined_at: string
  last_seen: string
}

interface RoundRow {
  id: string
  room_id: string
  round_index: number
  answer_song_id: string
  answer_title: string
  options: Array<{ song_id?: string; songId?: string; title: string }>
  media_type: MediaType
  media_path: string
  snippet_start: number
  snippet_duration: number
  status: 'active' | 'revealed'
  started_at: string
  ends_at: string
}

interface AnswerRow {
  id: string
  room_id: string
  round_index: number
  player_id: string
  picked_song_id: string | null
  answered_at: string
  points: number
  outcome: RoundOutcome
}

interface CreateRoomRpc {
  room: RoomRow
  player: PlayerRow
  host_token: string
  invite_secret?: string | null
}

interface JoinRoomRpc {
  room: RoomRow
  player: PlayerRow
}

export interface RoomPeek {
  pin: string
  status: RoomStatus
  visibility: RoomVisibility
  inviteSecret: string | null
  acceptsPlayers: boolean
  acceptsSpectators: boolean
}

const SESSION_KEY = 'taa.multi.session'

function randomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function toRoom(row: RoomRow): GameRoom {
  return {
    id: row.id,
    pin: row.pin,
    status: row.status,
    hostPlayerId: row.host_player_id,
    artistSlug: row.artist_slug,
    category: row.category as Category,
    rounds: row.rounds,
    timePerRound: row.time_per_round,
    maxPoints: row.max_points,
    currentRoundIndex: row.current_round_index,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    countdownEndsAt: row.countdown_ends_at ?? null,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    inviteSecret: row.invite_secret ?? null,
  }
}

function toPlayer(row: PlayerRow): RoomPlayer {
  return {
    id: row.id,
    roomId: row.room_id,
    nickname: row.nickname,
    isHost: row.is_host,
    role: row.role === 'spectator' ? 'spectator' : 'player',
    score: row.score,
    correctCount: row.correct_count,
    joinedAt: row.joined_at,
    lastSeen: row.last_seen,
  }
}

function toOptions(raw: RoundRow['options']): RoomRoundOption[] {
  return (raw ?? []).map((opt) => ({
    songId: opt.song_id ?? opt.songId ?? '',
    title: opt.title,
  }))
}

export function toRound(row: RoundRow): RoomRound {
  return {
    id: row.id,
    roomId: row.room_id,
    roundIndex: row.round_index,
    answerSongId: row.answer_song_id,
    answerTitle: row.answer_title,
    options: toOptions(row.options),
    mediaType: row.media_type,
    mediaPath: row.media_path,
    mediaUrl: resolveMediaUrl(row.media_path),
    snippetStart: Number(row.snippet_start) || 0,
    snippetDuration: Number(row.snippet_duration) || 15,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
  }
}

function toAnswer(row: AnswerRow): RoomAnswer {
  return {
    id: row.id,
    roomId: row.room_id,
    roundIndex: row.round_index,
    playerId: row.player_id,
    pickedSongId: row.picked_song_id,
    answeredAt: row.answered_at,
    points: row.points,
    outcome: row.outcome,
  }
}

function rpcMessage(error: { message: string }): string {
  const raw = error.message
  const match = raw.match(
    /Room not found|Room is not accepting|Room has expired|Room is full|Nickname already taken|PIN must be|Nickname must be|Not allowed|Invalid host|Round is not active|Round not found|Time is up|Already answered|Unexpected round|Cannot start|Options required|Invalid media|Player not in room|Room is closed|Cannot kick|Cannot start countdown|Authentication required|Private room requires invite|Invalid invite|Spectator limit reached|Spectators cannot answer|Room is not accepting spectators|Invalid visibility/i,
  )
  if (match) return match[0]
  if (raw.includes('duplicate key') || raw.includes('rooms_pin')) return 'PIN already in use'
  return raw
}

/** PostgREST may return jsonb as an object or a JSON string. */
function normalizeRpcPayload(data: unknown): unknown {
  if (data == null) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown
    } catch {
      return null
    }
  }
  return data
}

export function saveMultiSession(session: MultiSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadMultiSession(): MultiSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MultiSession
    return {
      ...parsed,
      role: parsed.role === 'spectator' ? 'spectator' : 'player',
      inviteSecret: parsed.inviteSecret ?? null,
    }
  } catch {
    return null
  }
}

export function clearMultiSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export interface CreateRoomInput {
  hostNickname: string
  artistSlug: string
  category: Category
  config: GameConfig
  visibility?: RoomVisibility
}

export interface RoomJoinResult {
  room: GameRoom
  player: RoomPlayer
  session: MultiSession
}

/** Create a lobby room and seat the host. Retries a few times on PIN collision. */
export async function createRoom(input: CreateRoomInput): Promise<RoomJoinResult> {
  await ensureAnonymousUser()
  const hostToken = randomToken()
  const nickname = input.hostNickname.trim().slice(0, 24)
  const visibility = input.visibility ?? 'public'
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 8; attempt++) {
    const pin = randomPin()
    const rpcArgs: Record<string, string | number> = {
      p_pin: pin,
      p_host_token: hostToken,
      p_host_nickname: nickname,
      p_artist_slug: input.artistSlug,
      p_category: input.category,
      p_rounds: input.config.rounds,
      p_time_per_round: input.config.timePerRound,
      p_max_points: input.config.maxPoints,
    }
    // Only send p_visibility when private so public create still works
    // before rooms-private-spectators.sql is applied.
    if (visibility === 'private') {
      rpcArgs.p_visibility = 'private'
    }

    const { data, error } = await supabase.rpc('create_room', rpcArgs)

    if (error) {
      lastError = new Error(`Өрөө үүсгэж чадсангүй: ${rpcMessage(error)}`)
      if (
        visibility === 'private' &&
        error.message.includes('Could not find the function') &&
        error.message.includes('p_visibility')
      ) {
        throw new Error(
          'Хувийн өрөөнд supabase/rooms-private-spectators.sql-ийг Supabase SQL Editor дээр ажиллуулна уу.',
        )
      }
      if (
        error.message.includes('duplicate') ||
        error.message.includes('unique') ||
        error.message.includes('rooms_pin')
      ) {
        continue
      }
      throw lastError
    }

    const payload = normalizeRpcPayload(data) as CreateRoomRpc | null
    if (!payload?.room?.id || !payload?.player?.id || !payload.host_token) {
      throw new Error('Өрөө үүсгэж чадсангүй: серверийн хариу буруу байна')
    }

    const room = toRoom({
      ...payload.room,
      invite_secret: payload.invite_secret ?? payload.room.invite_secret ?? null,
    })
    const player = toPlayer(payload.player)
    const session: MultiSession = {
      roomId: room.id,
      pin: room.pin,
      playerId: player.id,
      nickname: player.nickname,
      isHost: true,
      role: 'player',
      inviteSecret: room.inviteSecret,
      hostToken: payload.host_token,
    }
    saveMultiSession(session)
    return { room, player, session }
  }

  throw lastError ?? new Error('Өрөө үүсгэж чадсангүй: PIN олдсонгүй')
}

export interface JoinRoomInput {
  pin?: string | null
  invite?: string | null
  nickname: string
  asSpectator?: boolean
}

/** Join an existing room as a player (lobby) or spectator. */
export async function joinRoom(input: JoinRoomInput | string, nicknameArg?: string): Promise<RoomJoinResult> {
  await ensureAnonymousUser()

  // Back-compat: joinRoom(pin, nickname)
  const normalized: JoinRoomInput =
    typeof input === 'string'
      ? { pin: input, nickname: nicknameArg ?? '' }
      : input

  const nickname = normalized.nickname.trim().slice(0, 24)
  const pin = normalized.pin ? normalized.pin.replace(/\D/g, '').slice(0, 6) : null
  const invite = normalized.invite?.trim() || null
  const asSpectator = Boolean(normalized.asSpectator)

  let data: unknown
  let error: { message: string } | null = null

  if (invite && !pin) {
    const rpc = asSpectator ? 'join_room_spectator_by_invite' : 'join_room_by_invite'
    const result = await supabase.rpc(rpc, {
      p_invite: invite,
      p_nickname: nickname,
    })
    data = result.data
    error = result.error
  } else if (pin) {
    const rpc = asSpectator ? 'join_room_spectator' : 'join_room'
    const result = await supabase.rpc(rpc, {
      p_pin: pin,
      p_nickname: nickname,
      p_invite: invite,
    })
    data = result.data
    error = result.error
  } else {
    throw new Error('PIN эсвэл урилгын холбоос хэрэгтэй')
  }

  if (error) throw new Error(`Өрөөнд нэгдэж чадсангүй: ${rpcMessage(error)}`)

  const payload = normalizeRpcPayload(data) as JoinRoomRpc | null
  if (!payload?.room?.id || !payload?.player?.id) {
    throw new Error('Өрөөнд нэгдэж чадсангүй: серверийн хариу буруу байна')
  }

  const room = toRoom({
    ...payload.room,
    invite_secret: invite ?? payload.room.invite_secret ?? null,
  })
  const player = toPlayer(payload.player)
  const session: MultiSession = {
    roomId: room.id,
    pin: room.pin,
    playerId: player.id,
    nickname: player.nickname,
    isHost: Boolean(player.isHost),
    role: player.role,
    inviteSecret: room.visibility === 'private' ? invite : null,
    hostToken: null,
  }
  saveMultiSession(session)
  return { room, player, session }
}

export async function peekRoomByPin(pin: string): Promise<RoomPeek> {
  await ensureAnonymousUser()
  const cleaned = pin.replace(/\D/g, '').slice(0, 6)
  const { data, error } = await supabase.rpc('peek_room_by_pin', { p_pin: cleaned })
  if (error) throw new Error(rpcMessage(error))
  return toPeek(normalizeRpcPayload(data))
}

export async function peekRoomByInvite(invite: string): Promise<RoomPeek> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('peek_room_by_invite', {
    p_invite: invite.trim(),
  })
  if (error) throw new Error(rpcMessage(error))
  return toPeek(normalizeRpcPayload(data))
}

export async function rotateRoomInvite(roomId: string, hostToken: string): Promise<GameRoom> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('rotate_room_invite', {
    p_room_id: roomId,
    p_host_token: hostToken,
  })
  if (error) throw new Error(`Урилга шинэчилж чадсангүй: ${rpcMessage(error)}`)
  const payload = normalizeRpcPayload(data) as { room: RoomRow; invite_secret?: string } | null
  if (!payload?.room) throw new Error('Урилга шинэчилж чадсангүй')
  return toRoom({
    ...payload.room,
    invite_secret: payload.invite_secret ?? payload.room.invite_secret ?? null,
  })
}

function toPeek(raw: unknown): RoomPeek {
  const row = raw as {
    pin: string
    status: RoomStatus
    visibility?: string
    invite_secret?: string | null
    accepts_players?: boolean
    accepts_spectators?: boolean
  } | null
  if (!row?.pin) throw new Error('Өрөө олдсонгүй')
  return {
    pin: row.pin,
    status: row.status,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    inviteSecret: row.invite_secret ?? null,
    acceptsPlayers: Boolean(row.accepts_players),
    acceptsSpectators: Boolean(row.accepts_spectators),
  }
}

/** Leave the lobby. Host leave closes the room for everyone. */
export async function leaveRoom(roomId: string, playerId: string): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('leave_room', {
    p_room_id: roomId,
    p_player_id: playerId,
  })
  clearMultiSession()
  if (error) throw new Error(`Өрөөнөөс гарч чадсангүй: ${rpcMessage(error)}`)
}

/** Host closes the room for everyone. */
export async function closeRoom(roomId: string, hostToken: string): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('close_room', {
    p_room_id: roomId,
    p_host_token: hostToken,
  })
  clearMultiSession()
  if (error) throw new Error(`Өрөөг хааж чадсангүй: ${rpcMessage(error)}`)
}

export async function fetchRoom(roomId: string): Promise<GameRoom | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'id, pin, status, host_player_id, artist_slug, category, rounds, time_per_round, max_points, current_round_index, created_at, expires_at, countdown_ends_at, visibility',
    )
    .eq('id', roomId)
    .maybeSingle()

  if (error) {
    // Older DBs before rooms-polish.sql may lack countdown_ends_at.
    if (error.message.includes('countdown_ends_at') || error.message.includes('visibility')) {
      const fallback = await supabase
        .from('rooms')
        .select(
          'id, pin, status, host_player_id, artist_slug, category, rounds, time_per_round, max_points, current_round_index, created_at, expires_at',
        )
        .eq('id', roomId)
        .maybeSingle()
      if (fallback.error) throw new Error(`Өрөөг татаж чадсангүй: ${fallback.error.message}`)
      return fallback.data ? toRoom({ ...(fallback.data as RoomRow), countdown_ends_at: null }) : null
    }
    throw new Error(`Өрөөг татаж чадсангүй: ${error.message}`)
  }
  return data ? toRoom(data as RoomRow) : null
}

export async function fetchRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase
    .from('room_players')
    .select('id, room_id, nickname, is_host, role, score, correct_count, joined_at, last_seen')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true })

  if (error) {
    if (error.message.includes('role')) {
      const fallback = await supabase
        .from('room_players')
        .select('id, room_id, nickname, is_host, score, correct_count, joined_at, last_seen')
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true })
      if (fallback.error) throw new Error(`Тоглогчдыг татаж чадсангүй: ${fallback.error.message}`)
      return ((fallback.data ?? []) as PlayerRow[]).map(toPlayer)
    }
    throw new Error(`Тоглогчдыг татаж чадсангүй: ${error.message}`)
  }
  return ((data ?? []) as PlayerRow[]).map(toPlayer)
}

export async function fetchRoomRound(
  roomId: string,
  roundIndex: number,
): Promise<RoomRound | null> {
  const { data, error } = await supabase
    .from('room_rounds')
    .select(
      'id, room_id, round_index, answer_song_id, answer_title, options, media_type, media_path, snippet_start, snippet_duration, status, started_at, ends_at',
    )
    .eq('room_id', roomId)
    .eq('round_index', roundIndex)
    .maybeSingle()

  if (error) throw new Error(`Раундыг татаж чадсангүй: ${error.message}`)
  return data ? toRound(data as RoundRow) : null
}

export async function fetchRoundAnswers(
  roomId: string,
  roundIndex: number,
): Promise<RoomAnswer[]> {
  const { data, error } = await supabase
    .from('room_answers')
    .select('id, room_id, round_index, player_id, picked_song_id, answered_at, points, outcome')
    .eq('room_id', roomId)
    .eq('round_index', roundIndex)

  if (error) throw new Error(`Хариултуудыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as AnswerRow[]).map(toAnswer)
}

export interface StartRoundInput {
  roomId: string
  hostToken: string
  roundIndex: number
  song: Song
  options: RoomRoundOption[]
}

/** Host publishes the next synced round (answer + options + media + deadline). */
export async function startRoomRound(input: StartRoundInput): Promise<RoomRound> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('start_room_round', {
    p_room_id: input.roomId,
    p_host_token: input.hostToken,
    p_round_index: input.roundIndex,
    p_answer_song_id: input.song.id,
    p_answer_title: input.song.title,
    p_options: input.options.map((opt) => ({ song_id: opt.songId, title: opt.title })),
    p_media_type: input.song.mediaType,
    p_media_path: input.song.mediaPath,
    p_snippet_start: input.song.snippetStart,
    p_snippet_duration: input.song.snippetDuration,
  })

  if (error) throw new Error(`Раунд эхлүүлж чадсангүй: ${rpcMessage(error)}`)
  const payload = data as { round: RoundRow }
  return toRound(payload.round)
}

/** Submit one answer while the round is active. Points are computed server-side. */
export async function submitRoomAnswer(
  roomId: string,
  playerId: string,
  roundIndex: number,
  pickedSongId: string,
): Promise<RoomAnswer> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('submit_room_answer', {
    p_room_id: roomId,
    p_player_id: playerId,
    p_round_index: roundIndex,
    p_picked_song_id: pickedSongId,
  })

  if (error) throw new Error(`Хариулж чадсангүй: ${rpcMessage(error)}`)
  return toAnswer(data as AnswerRow)
}

/** Host locks the round, applies timeouts + scores, moves room to revealing. */
export async function revealRoomRound(
  roomId: string,
  hostToken: string,
  roundIndex: number,
): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('reveal_room_round', {
    p_room_id: roomId,
    p_host_token: hostToken,
    p_round_index: roundIndex,
  })
  if (error) throw new Error(`Раунд илчилж чадсангүй: ${rpcMessage(error)}`)
}

/** Host marks the game finished after the last reveal. */
export async function finishRoomGame(roomId: string, hostToken: string): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('finish_room_game', {
    p_room_id: roomId,
    p_host_token: hostToken,
  })
  if (error) throw new Error(`Тоглоом дуусгаж чадсангүй: ${rpcMessage(error)}`)
}

/** Host clears a finished room so the same players can start a rematch. */
export async function restartRoomGame(roomId: string, hostToken: string): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('restart_room_game', {
    p_room_id: roomId,
    p_host_token: hostToken,
  })
  if (error) throw new Error(`Дахин эхлүүлж чадсангүй: ${rpcMessage(error)}`)
}

/** Host starts a synced 3-2-1 countdown before the next round. */
export async function beginRoomCountdown(
  roomId: string,
  hostToken: string,
  seconds = 3,
): Promise<GameRoom> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('begin_room_countdown', {
    p_room_id: roomId,
    p_host_token: hostToken,
    p_seconds: seconds,
  })
  if (error) throw new Error(`Countdown эхлүүлж чадсангүй: ${rpcMessage(error)}`)
  return toRoom(data as RoomRow)
}

/** Touch last_seen so the host can prune disconnected guests. */
export async function heartbeatRoomPlayer(roomId: string, playerId: string): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('heartbeat_room_player', {
    p_room_id: roomId,
    p_player_id: playerId,
  })
  if (error) throw new Error(`Heartbeat амжилтгүй: ${rpcMessage(error)}`)
}

/** Host removes one guest from the room. */
export async function kickRoomPlayer(
  roomId: string,
  hostToken: string,
  playerId: string,
): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('kick_room_player', {
    p_room_id: roomId,
    p_host_token: hostToken,
    p_player_id: playerId,
  })
  if (error) throw new Error(`Тоглогчийг хасч чадсангүй: ${rpcMessage(error)}`)
}

/** Host drops guests whose last_seen is older than idleSeconds. */
export async function pruneIdleRoomPlayers(
  roomId: string,
  hostToken: string,
  idleSeconds = 90,
): Promise<number> {
  await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('prune_idle_room_players', {
    p_room_id: roomId,
    p_host_token: hostToken,
    p_idle_seconds: idleSeconds,
  })
  if (error) throw new Error(`Idle prune амжилтгүй: ${rpcMessage(error)}`)
  return typeof data === 'number' ? data : 0
}

/** True when last_seen is within the online window. */
export function isPlayerOnline(lastSeen: string, windowMs = 45_000): boolean {
  const t = new Date(lastSeen).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t < windowMs
}
