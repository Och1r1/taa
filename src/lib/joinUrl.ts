/** Normalize a room PIN to exactly 6 digits, or null if invalid. */
export function normalizeJoinPin(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 6)
  return digits.length === 6 ? digits : null
}

/** Public-room join URL: `/join?pin=123456`. */
export function buildJoinUrl(pin: string, origin = window.location.origin): string {
  const clean = normalizeJoinPin(pin)
  if (!clean) throw new Error('PIN 6 оронтой байх ёстой')
  const url = new URL('/join', origin)
  url.searchParams.set('pin', clean)
  return url.toString()
}

/** Read a join PIN from the current URL (`/join?pin=` or `?pin=`). */
export function readJoinPinFromUrl(
  search = window.location.search,
  pathname = window.location.pathname,
): string | null {
  const params = new URLSearchParams(search)
  const fromQuery = normalizeJoinPin(params.get('pin'))
  if (fromQuery) return fromQuery
  // Allow /join/123456 as a convenience deep link.
  const match = pathname.match(/^\/join\/(\d{1,6})\/?$/i)
  return match ? normalizeJoinPin(match[1]) : null
}

/** Strip join params from the address bar after the PIN is applied. */
export function clearJoinPinFromUrl(): void {
  const url = new URL(window.location.href)
  const hadPin = url.searchParams.has('pin')
  const onJoinPath = /^\/join(\/|$)/i.test(url.pathname)
  if (!hadPin && !onJoinPath) return
  url.searchParams.delete('pin')
  if (onJoinPath) url.pathname = '/'
  window.history.replaceState({}, '', url)
}
