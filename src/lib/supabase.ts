import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const AUDIO_BUCKET =
  (import.meta.env.VITE_SUPABASE_AUDIO_BUCKET as string | undefined) ?? 'song-audio'

/** True when Supabase env vars are present, so the UI can show a helpful hint if not. */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[taa] Supabase is not configured. Copy .env.example to .env.local and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

// Fall back to harmless placeholders so createClient does not throw at import time;
// actual requests will surface a clear error and the UI guards on isSupabaseConfigured.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
)

/**
 * Ensure multiplayer requests have a Supabase identity. Anonymous accounts let
 * guests play without a sign-up while allowing room RPCs to safely identify them.
 */
export async function ensureMultiplayerSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase тохируулагдаагүй байна.')
  }

  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (data.session) return

  const { error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw new Error(
      `Түр тоглогчийн эрх үүсгэж чадсангүй: ${error.message}. ` +
        'Supabase дээр Anonymous Sign-Ins идэвхтэй эсэхийг шалгана уу.',
    )
  }
}
