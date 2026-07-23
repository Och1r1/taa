import { ensureAnonymousUser } from './auth'
import { loadProgress, mergeProgress, saveProgress, type PlayerProgress } from '../lib/progression'
import { supabase } from '../lib/supabase'

/** Merge local and account progress, then persist the non-destructive result to both places. */
export async function syncProgress(): Promise<PlayerProgress> {
  const userId = await ensureAnonymousUser()
  const local = loadProgress()
  const { data, error } = await supabase
    .from('player_progress')
    .select('progress')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`Ахиц татаж чадсангүй: ${error.message}`)
  const remote = data?.progress as PlayerProgress | undefined
  const merged = remote ? mergeProgress(local, remote) : local
  const { error: saveError } = await supabase
    .from('player_progress')
    .upsert({ user_id: userId, progress: merged }, { onConflict: 'user_id' })
  if (saveError) throw new Error(`Ахиц хадгалж чадсангүй: ${saveError.message}`)
  saveProgress(merged)
  return merged
}
