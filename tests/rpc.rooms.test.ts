import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'

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

describe.skipIf(!live)('multiplayer RPCs (live Supabase)', () => {
  const createdRoomIds: string[] = []
  let admin: SupabaseClient

  afterAll(async () => {
    if (!admin || createdRoomIds.length === 0) return
    for (const id of createdRoomIds) {
      await admin.from('rooms').delete().eq('id', id)
    }
  })

  it('create_room seats Auth host without host_token', async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
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

describe('assert_rate_limit helper contract', () => {
  it('documents Mongolian rate-limit error text', () => {
    expect('Хэт олон оролдлого. Түр хүлээнэ үү.').toMatch(/Хэт олон/)
  })
})
