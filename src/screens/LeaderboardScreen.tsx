import { useEffect, useState } from 'react'
import type { ScoreEntry } from '../types'
import { EqualizerBars } from '../components/EqualizerBars'
import { fetchGlobalTopScores } from '../api/scores'
import { isSupabaseConfigured } from '../lib/supabase'

interface Props {
  onBack: () => void
}

const RANK = ['🥇', '🥈', '🥉']

/** Capitalize an artist slug for display (e.g. "morningstar" → "Morningstar"). */
function prettyArtist(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

export function LeaderboardScreen({ onBack }: Props) {
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetchGlobalTopScores()
      .then((list) => !cancelled && setScores(list))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      {/* Top bar */}
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <EqualizerBars className="h-6" />
          <span className="text-xl font-extrabold tracking-tight">Таа</span>
        </div>
        <button onClick={onBack} className="text-sm text-muted hover:text-ink">
          ← Нүүр
        </button>
      </div>

      {/* Title */}
      <div className="mb-8 animate-fade-up">
        <h1 className="text-4xl font-extrabold leading-tight">
          🏆 <span className="text-amber">Тэргүүлэгчид</span>
        </h1>
        <p className="mt-2 text-muted">Бүх уран бүтээлчээр хамгийн өндөр оноо авсан тоглогчид.</p>
      </div>

      {!isSupabaseConfigured ? (
        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          ⚠ Supabase тохируулаагүй байна.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-3 text-muted">
          <EqualizerBars className="h-5" /> Ачааллаж байна…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {error}
        </p>
      ) : scores.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-muted">
          Одоохондоо оноо алга. Тоглоод эхний тэргүүлэгч бол! 🎵
        </p>
      ) : (
        <div className="space-y-2">
          {scores.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center gap-4 rounded-2xl border px-5 py-4 ${
                i < 3 ? 'border-amber/40 bg-amber/5' : 'border-border bg-surface'
              }`}
            >
              <span className="w-8 text-center text-lg font-black text-muted-2">
                {RANK[i] ?? i + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-ink">{s.playerName}</div>
                <div className="text-xs text-muted-2">
                  {prettyArtist(s.artistSlug)} · {s.correctCount}/{s.rounds} зөв
                </div>
              </div>
              <span className="ml-auto text-lg font-extrabold text-cyan">
                {s.points.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
