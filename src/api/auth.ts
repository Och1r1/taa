import { isSupabaseConfigured, supabase } from '../lib/supabase'

/**
 * Ensures every browser has a Supabase identity before it performs a room action.
 * Anonymous sign-in must be enabled in Supabase Authentication → Providers.
 * Refresh restores the same identity via the persisted Auth session.
 */
export async function ensureAnonymousUser(): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase тохируулагдаагүй байна.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(`Нэвтрэх төлөв шалгаж чадсангүй: ${sessionError.message}`)
  if (sessionData.session?.user) return sessionData.session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) {
    throw new Error(
      `Нэргүй нэвтрэх амжилтгүй: ${error?.message ?? 'Хэрэглэгч үүссэнгүй'}. ` +
        'Supabase дээр Anonymous Sign-Ins идэвхжүүлнэ үү.',
    )
  }

  return data.user.id
}
