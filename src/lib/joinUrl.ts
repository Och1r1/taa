/** Normalize a room PIN to exactly 6 digits, or null if invalid. */
export function normalizeJoinPin(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 6)
  return digits.length === 6 ? digits : null
}

/** Normalize a private invite secret, or null if too short. */
export function normalizeInviteSecret(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length >= 16 ? trimmed : null
}

/** Public-room join URL: `/join?pin=123456`. */
export function buildJoinUrl(pin: string, origin = window.location.origin): string {
  const clean = normalizeJoinPin(pin)
  if (!clean) throw new Error('PIN 6 оронтой байх ёстой')
  const url = new URL('/join', origin)
  url.searchParams.set('pin', clean)
  return url.toString()
}

/** Private-room invite URL: `/join?invite=…`. */
export function buildInviteUrl(inviteSecret: string, origin = window.location.origin): string {
  const clean = normalizeInviteSecret(inviteSecret)
  if (!clean) throw new Error('Урилга буруу байна')
  const url = new URL('/join', origin)
  url.searchParams.set('invite', clean)
  return url.toString()
}

/** Best share URL for a room (invite for private, PIN for public). */
export function buildRoomShareUrl(input: {
  pin: string
  visibility: 'public' | 'private'
  inviteSecret: string | null
}, origin = window.location.origin): string {
  if (input.visibility === 'private') {
    if (!input.inviteSecret) throw new Error('Хувийн өрөөнд урилга хэрэгтэй')
    return buildInviteUrl(input.inviteSecret, origin)
  }
  return buildJoinUrl(input.pin, origin)
}

export interface JoinLinkParams {
  pin: string | null
  invite: string | null
}

/** Read join PIN and/or invite from the current URL. */
export function readJoinParamsFromUrl(
  search = window.location.search,
  pathname = window.location.pathname,
): JoinLinkParams {
  const params = new URLSearchParams(search)
  const invite = normalizeInviteSecret(params.get('invite'))
  let pin = normalizeJoinPin(params.get('pin'))
  if (!pin) {
    const match = pathname.match(/^\/join\/(\d{1,6})\/?$/i)
    pin = match ? normalizeJoinPin(match[1]) : null
  }
  return { pin, invite }
}

/** @deprecated Prefer readJoinParamsFromUrl */
export function readJoinPinFromUrl(
  search = window.location.search,
  pathname = window.location.pathname,
): string | null {
  return readJoinParamsFromUrl(search, pathname).pin
}

/** Strip join params from the address bar after they are applied. */
export function clearJoinPinFromUrl(): void {
  const url = new URL(window.location.href)
  const hadPin = url.searchParams.has('pin')
  const hadInvite = url.searchParams.has('invite')
  const onJoinPath = /^\/join(\/|$)/i.test(url.pathname)
  if (!hadPin && !hadInvite && !onJoinPath) return
  url.searchParams.delete('pin')
  url.searchParams.delete('invite')
  if (onJoinPath) url.pathname = '/'
  window.history.replaceState({}, '', url)
}
