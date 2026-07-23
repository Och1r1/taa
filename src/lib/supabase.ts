import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const usesExampleUrl = url?.includes('YOUR_PROJECT_REF.supabase.co') ?? false

export const AUDIO_BUCKET =
  (import.meta.env.VITE_SUPABASE_AUDIO_BUCKET as string | undefined) ?? 'song-audio'

/** True when Supabase env vars are present, so the UI can show a helpful hint if not. */
export const isSupabaseConfigured = Boolean(url && anonKey && !usesExampleUrl)
export const supabaseConfigurationError = !url || !anonKey
  ? 'Supabase тохируулаагүй байна. .env.local файлд төслийн URL болон anon key-гээ оруулна уу.'
  : usesExampleUrl
    ? 'Supabase-ийн жишээ URL ашиглаж байна. .env.local доторх YOUR_PROJECT_REF-ийг өөрийн төслийн URL-ээр солиод хөгжүүлэлтийн серверээ дахин асаана уу.'
    : null

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    `[taa] ${supabaseConfigurationError}`,
  )
}

// Fall back to harmless placeholders so createClient does not throw at import time;
// actual requests will surface a clear error and the UI guards on isSupabaseConfigured.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)

/**
 * @deprecated Prefer `ensureAnonymousUser` from `src/api/auth.ts`.
 * Kept for older call sites; anonymous accounts let guests play without sign-up.
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
