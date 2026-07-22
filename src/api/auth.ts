import { isSupabaseConfigured, supabase } from '../lib/supabase'

export const DISPLAY_NAME_KEY = 'taa_player_name'

export interface Profile {
  id: string
  displayName: string | null
  updatedAt: string
}

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

/** Ensure auth + a profiles row; optionally seed display_name from localStorage. */
export async function ensureProfile(seedName?: string | null): Promise<Profile> {
  await ensureAnonymousUser()
  const seed =
    seedName?.trim() ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem(DISPLAY_NAME_KEY)?.trim() : null) ||
    null

  const { data, error } = await supabase.rpc('ensure_profile', {
    p_display_name: seed && seed.length >= 2 ? seed.slice(0, 24) : null,
  })
  if (error) throw new Error(`Профайл үүсгэж чадсангүй: ${error.message}`)
  const profile = toProfile(data)
  if (profile.displayName) {
    localStorage.setItem(DISPLAY_NAME_KEY, profile.displayName)
  }
  return profile
}

export async function getProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null
  const { data: sessionData } = await supabase.auth.getSession()
  const uid = sessionData.session?.user?.id
  if (!uid) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, updated_at')
    .eq('id', uid)
    .maybeSingle()

  if (error) throw new Error(`Профайл татаж чадсангүй: ${error.message}`)
  if (!data) return null
  return toProfile(data)
}

export async function updateDisplayName(name: string): Promise<Profile> {
  await ensureAnonymousUser()
  const trimmed = name.trim().slice(0, 24)
  if (trimmed.length < 2) {
    throw new Error('Нэр 2–24 тэмдэгт байх ёстой')
  }

  const { data, error } = await supabase.rpc('update_display_name', {
    p_display_name: trimmed,
  })
  if (error) throw new Error(`Нэр хадгалж чадсангүй: ${error.message}`)
  const profile = toProfile(data)
  if (profile.displayName) {
    localStorage.setItem(DISPLAY_NAME_KEY, profile.displayName)
  }
  return profile
}

/** Email magic link — upgrades / signs in without a password (dashboard email must be enabled). */
export async function sendMagicLink(email: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase тохируулагдаагүй байна.')
  }
  const trimmed = email.trim()
  if (!trimmed.includes('@')) {
    throw new Error('И-мэйл хаяг буруу байна')
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      shouldCreateUser: true,
    },
  })
  if (error) throw new Error(`И-мэйл илгээж чадсангүй: ${error.message}`)
}

export async function getAuthEmail(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user || user.is_anonymous) return null
  return user.email ?? null
}

/** Resolve a preferred display name: profile → localStorage → empty. */
export async function resolveDisplayName(): Promise<string> {
  const local = typeof localStorage !== 'undefined' ? localStorage.getItem(DISPLAY_NAME_KEY)?.trim() ?? '' : ''
  if (!isSupabaseConfigured) return local

  try {
    const profile = await ensureProfile(local || null)
    return profile.displayName?.trim() || local
  } catch {
    return local
  }
}

function toProfile(row: unknown): Profile {
  const r = row as { id: string; display_name: string | null; updated_at: string }
  return {
    id: r.id,
    displayName: r.display_name?.trim() || null,
    updatedAt: r.updated_at,
  }
}
