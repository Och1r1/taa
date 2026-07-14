import { useEffect, useState } from 'react'
import type { RoundResult, ScoreEntry } from '../types'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { fetchTopScores, saveScore } from '../api/scores'
import { isSupabaseConfigured } from '../lib/supabase'

interface Props {
  score: number
  results: RoundResult[]
  artistSlug: string | null
  onPlayAgain: () => void
  onHome: () => void
}

const NAME_KEY = 'taa_player_name'

export function ResultsScreen({ score, results, artistSlug, onPlayAgain, onHome }: Props) {
  const correctCount = results.filter((r) => r.correct).length
  const maxScore = results.length * 1000

  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loadingScores, setLoadingScores] = useState(true)

  const canUseLeaderboard = isSupabaseConfigured && Boolean(artistSlug)

  useEffect(() => {
    if (!canUseLeaderboard || !artistSlug) {
      setLoadingScores(false)
      return
    }
    let cancelled = false
    fetchTopScores(artistSlug)
      .then((list) => !cancelled && setScores(list))
      .catch(() => !cancelled && setScores([]))
      .finally(() => !cancelled && setLoadingScores(false))
    return () => {
      cancelled = true
    }
  }, [artistSlug, canUseLeaderboard])

  async function handleSave() {
    if (!artistSlug || !name.trim() || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const entry = await saveScore({
        playerName: name.trim(),
        artistSlug,
        points: score,
        correctCount,
        rounds: results.length,
      })
      localStorage.setItem(NAME_KEY, name.trim())
      setSavedId(entry.id)
      const list = await fetchTopScores(artistSlug)
      setScores(list)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-14">
      <div className="flex flex-col items-center text-center animate-fade-up">
        <EqualizerBars className="mb-6 h-10" />
        <div className="text-sm font-bold uppercase tracking-widest text-muted-2">
          Тоглоом дууслаа
        </div>
        <div className="mt-3 bg-gradient-to-r from-pink via-purple to-cyan bg-clip-text text-6xl font-black text-transparent">
          {score.toLocaleString()}
        </div>
        <div className="mt-2 text-muted">
          {correctCount} / {results.length} зөв · дээд оноо {maxScore.toLocaleString()}
        </div>
      </div>

      {/* Round breakdown */}
      <div className="mt-10">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-2">
          Раундын дүн
        </div>
        <div className="space-y-2">
          {results.map((r) => (
            <div
              key={r.roundIndex}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <span className="text-xs font-bold text-muted-2">Р{r.roundIndex + 1}</span>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  r.correct ? 'bg-accent-green/15 text-accent-green' : 'bg-pink/15 text-pink'
                }`}
              >
                {r.correct ? '✓' : '✕'}
              </span>
              <span className="truncate text-sm text-ink-soft">{r.answerTitle}</span>
              {r.hintUsed && <span className="text-xs text-amber">💡</span>}
              <span className="ml-auto text-sm font-bold text-cyan">
                +{r.points.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Save score */}
      {canUseLeaderboard && !savedId && (
        <div className="mt-8 rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 text-sm font-semibold text-ink">Онооны самбарт нэрээ бичих</div>
          <div className="flex gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              maxLength={24}
              placeholder="Таны нэр"
              className="flex-1 rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none placeholder:text-muted-2 focus:border-cyan/60"
            />
            <Button onClick={handleSave} disabled={!name.trim() || saving}>
              {saving ? 'Хадгалж…' : 'Хадгалах'}
            </Button>
          </div>
          {saveError && <p className="mt-2 text-sm text-pink">{saveError}</p>}
        </div>
      )}

      {/* Leaderboard */}
      {canUseLeaderboard && (
        <div className="mt-8">
          <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-2">
            Онооны самбар
          </div>
          {loadingScores ? (
            <p className="text-sm text-muted">Ачааллаж байна…</p>
          ) : scores.length === 0 ? (
            <p className="text-sm text-muted">Одоохондоо оноо алга. Эхнийх нь бол!</p>
          ) : (
            <div className="space-y-2">
              {scores.map((s, i) => {
                const isMine = s.id === savedId
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                      isMine ? 'border-cyan bg-cyan/10' : 'border-border bg-surface'
                    }`}
                  >
                    <span className="w-6 text-sm font-bold text-muted-2">{i + 1}</span>
                    <span className="truncate text-sm font-semibold text-ink">{s.playerName}</span>
                    <span className="text-xs text-muted-2">
                      {s.correctCount}/{s.rounds}
                    </span>
                    <span className="ml-auto text-sm font-bold text-cyan">
                      {s.points.toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onPlayAgain} className="flex-1">
          ↻ Дахин тоглох
        </Button>
        <Button variant="ghost" onClick={onHome} className="flex-1">
          Нүүр хуудас
        </Button>
      </div>
    </div>
  )
}
