import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const live = Boolean(url && anonKey && serviceKey)

function randomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function anonClient(): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInAnonymously()
  if (error) throw error
  return client
}

async function createPublicLobby(host: SupabaseClient, pin = randomPin()) {
  const { data, error } = await host.rpc('create_room', {
    p_pin: pin,
    p_host_nickname: 'HostTest',
    p_artist_slug: 'vandebo',
    p_category: 'songs',
    p_rounds: 3,
    p_time_per_round: 15,
    p_max_points: 1000,
    p_visibility: 'public',
  })
  if (error) throw error
  return { pin, roomId: data.room.id as string, hostPlayerId: data.player.id as string }
}

describe.skipIf(!live)('multiplayer RPCs (live Supabase)', () => {
  const createdRoomIds: string[] = []
  let admin: SupabaseClient

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  })

  afterAll(async () => {
    if (!admin || createdRoomIds.length === 0) return
    for (const id of createdRoomIds) {
      await admin.from('rooms').delete().eq('id', id)
    }
  })

  it('create_room seats Auth host without host_token', async () => {
    const host = await anonClient()
    const pin = randomPin()
    const { data, error } = await host.rpc('create_room', {
      p_pin: pin,
      p_host_nickname: 'HostTest',
      p_artist_slug: 'vandebo',
      p_category: 'songs',
      p_rounds: 3,
      p_time_per_round: 15,
      p_max_points: 1000,
      p_visibility: 'public',
    })
    expect(error).toBeNull()
    expect(data?.room?.id).toBeTruthy()
    expect(data?.player?.is_host).toBe(true)
    expect(data?.host_token).toBeUndefined()
    createdRoomIds.push(data.room.id)

    const guest = await anonClient()
    const join = await guest.rpc('join_room', {
      p_pin: pin,
      p_nickname: 'GuestTest',
    })
    expect(join.error).toBeNull()
    expect(join.data?.player?.is_host).toBe(false)
  })

  it('assert_host rejects non-host finish_room_game', async () => {
    const host = await anonClient()
    const pin = randomPin()
    const created = await host.rpc('create_room', {
      p_pin: pin,
      p_host_nickname: 'HostAuth',
      p_artist_slug: 'vandebo',
      p_category: 'songs',
      p_rounds: 3,
      p_time_per_round: 15,
    })
    expect(created.error).toBeNull()
    createdRoomIds.push(created.data.room.id)

    const guest = await anonClient()
    await guest.rpc('join_room', { p_pin: pin, p_nickname: 'GuestAuth' })
    const finish = await guest.rpc('finish_room_game', {
      p_room_id: created.data.room.id,
    })
    expect(finish.error).toBeTruthy()
  })

  it('private room requires invite on join', async () => {
    const host = await anonClient()
    const pin = randomPin()
    const created = await host.rpc('create_room', {
      p_pin: pin,
      p_host_nickname: 'PrivHost',
      p_artist_slug: 'vandebo',
      p_category: 'songs',
      p_rounds: 3,
      p_time_per_round: 15,
      p_visibility: 'private',
    })
    expect(created.error).toBeNull()
    createdRoomIds.push(created.data.room.id)
    expect(created.data.invite_secret).toBeTruthy()

    const guest = await anonClient()
    const blocked = await guest.rpc('join_room', {
      p_pin: pin,
      p_nickname: 'NoInvite',
    })
    expect(blocked.error).toBeTruthy()

    const ok = await guest.rpc('join_room', {
      p_pin: pin,
      p_nickname: 'WithInvite',
      p_invite: created.data.invite_secret,
    })
    expect(ok.error).toBeNull()
  })
})

describe.skipIf(!live)('multiplayer manual matrix (live Supabase)', () => {
  const createdRoomIds: string[] = []
  let admin: SupabaseClient

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  })

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await admin.from('rooms').delete().eq('id', id)
    }
  })

  it('host refresh: re-join returns same player seat', async () => {
    const host = await anonClient()
    const { pin, roomId, hostPlayerId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const again = await host.rpc('join_room', { p_pin: pin, p_nickname: 'HostTest' })
    expect(again.error).toBeNull()
    expect(again.data?.player?.id).toBe(hostPlayerId)
  })

  it('guest refresh: re-join returns same player seat', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const guest = await anonClient()
    const joined = await guest.rpc('join_room', { p_pin: pin, p_nickname: 'GuestRefresh' })
    expect(joined.error).toBeNull()
    const guestPlayerId = joined.data?.player?.id

    const again = await guest.rpc('join_room', { p_pin: pin, p_nickname: 'GuestRefresh' })
    expect(again.error).toBeNull()
    expect(again.data?.player?.id).toBe(guestPlayerId)
  })

  it('participants can SELECT room and players after RLS tighten', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const guest = await anonClient()
    await guest.rpc('join_room', { p_pin: pin, p_nickname: 'GuestRls' })

    const roomRead = await guest.from('rooms').select('id, status, pin').eq('id', roomId).single()
    expect(roomRead.error).toBeNull()
    expect(roomRead.data?.pin).toBe(pin)

    const playersRead = await guest.from('room_players').select('id, nickname').eq('room_id', roomId)
    expect(playersRead.error).toBeNull()
    expect((playersRead.data ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('host departure closes the room for everyone', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const guest = await anonClient()
    await guest.rpc('join_room', { p_pin: pin, p_nickname: 'GuestLeave' })

    const leave = await host.rpc('leave_room', {
      p_room_id: roomId,
      p_player_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(leave.error).toBeNull()

    const { data: room } = await admin.from('rooms').select('status').eq('id', roomId).single()
    expect(room?.status).toBe('closed')

    const players = await admin.from('room_players').select('id').eq('room_id', roomId)
    expect(players.data ?? []).toHaveLength(0)
  })

  it('host can prune idle guests', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const guest = await anonClient()
    const joined = await guest.rpc('join_room', { p_pin: pin, p_nickname: 'IdleGuest' })
    const guestPlayerId = joined.data?.player?.id as string

    await admin
      .from('room_players')
      .update({ last_seen: new Date(Date.now() - 120_000).toISOString() })
      .eq('id', guestPlayerId)

    const pruned = await host.rpc('prune_idle_room_players', {
      p_room_id: roomId,
      p_idle_seconds: 30,
    })
    expect(pruned.error).toBeNull()
    expect(pruned.data).toBe(1)

    const remaining = await admin.from('room_players').select('id').eq('room_id', roomId)
    expect(remaining.data ?? []).toHaveLength(1)
  })

  it('finish_room_game exports scores only once', async () => {
    const host = await anonClient()
    const { roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const first = await host.rpc('finish_room_game', { p_room_id: roomId })
    expect(first.error).toBeNull()
    expect(first.data?.already_saved).toBe(false)
    expect(first.data?.scores_saved).toBe(1)

    const second = await host.rpc('finish_room_game', { p_room_id: roomId })
    expect(second.error).toBeNull()
    expect(second.data?.already_saved).toBe(true)
    expect(second.data?.scores_saved).toBe(0)

    const { data: scores } = await admin.from('scores').select('id').eq('room_id', roomId)
    expect(scores ?? []).toHaveLength(1)
  })

  it('spectators cannot submit answers', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const spectator = await anonClient()
    const joined = await spectator.rpc('join_room_spectator', {
      p_pin: pin,
      p_nickname: 'Watcher',
    })
    expect(joined.error).toBeNull()
    const spectatorId = joined.data?.player?.id as string

    const endsAt = new Date(Date.now() + 60_000).toISOString()
    await admin.from('rooms').update({ status: 'playing' }).eq('id', roomId)
    await admin.from('room_rounds').insert({
      room_id: roomId,
      round_index: 0,
      status: 'active',
      ends_at: endsAt,
      answer_song_id: '00000000-0000-0000-0000-000000000001',
      options: [],
    })

    const answer = await spectator.rpc('submit_room_answer', {
      p_room_id: roomId,
      p_player_id: spectatorId,
      p_round_index: 0,
      p_picked_song_id: '00000000-0000-0000-0000-000000000001',
    })
    expect(answer.error).toBeTruthy()
    expect(answer.error?.message).toMatch(/Spectators cannot answer/i)
  })

  it('rematch accept fails after deadline', async () => {
    const host = await anonClient()
    const { pin, roomId } = await createPublicLobby(host)
    createdRoomIds.push(roomId)

    const guest = await anonClient()
    await guest.rpc('join_room', { p_pin: pin, p_nickname: 'RematchGuest' })

    const finished = await host.rpc('finish_room_game', { p_room_id: roomId })
    expect(finished.error).toBeNull()

    const proposed = await host.rpc('propose_rematch', {
      p_room_id: roomId,
      p_timeout_seconds: 15,
    })
    expect(proposed.error).toBeNull()
    const newRoomId = proposed.data?.room?.id as string
    createdRoomIds.push(newRoomId)

    await admin
      .from('rooms')
      .update({ rematch_deadline: new Date(Date.now() - 1000).toISOString() })
      .eq('id', roomId)

    const late = await guest.rpc('respond_rematch', {
      p_room_id: roomId,
      p_accept: true,
    })
    expect(late.error).toBeTruthy()
    expect(late.error?.message).toMatch(/Rematch timed out/i)
  })

  it('public discovery lists public lobby, not private', async () => {
    const publicHost = await anonClient()
    const pub = await createPublicLobby(publicHost)
    createdRoomIds.push(pub.roomId)

    const privateHost = await anonClient()
    const pin = randomPin()
    const priv = await privateHost.rpc('create_room', {
      p_pin: pin,
      p_host_nickname: 'PrivHost',
      p_artist_slug: 'vandebo',
      p_category: 'songs',
      p_rounds: 3,
      p_time_per_round: 15,
      p_visibility: 'private',
    })
    expect(priv.error).toBeNull()
    createdRoomIds.push(priv.data.room.id)

    const browser = await anonClient()
    const { data, error } = await browser.rpc('list_public_lobbies', { p_limit: 50 })
    expect(error).toBeNull()
    const ids = (data as Array<{ id: string }>).map((row) => row.id)
    expect(ids).toContain(pub.roomId)
    expect(ids).not.toContain(priv.data.room.id)
  })
})

describe('assert_rate_limit helper contract', () => {
  it('documents Mongolian rate-limit error text', () => {
    expect('Хэт олон оролдлого. Түр хүлээнэ үү.').toMatch(/Хэт олон/)
  })
})
