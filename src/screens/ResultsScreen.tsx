import { useEffect, useRef, useState } from 'react'
import type { Category, RoundResult, ScoreEntry } from '../types'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { DISPLAY_NAME_KEY, updateDisplayName } from '../api/auth'
import { fetchTopScores, saveScore } from '../api/scores'
import { isSupabaseConfigured } from '../lib/supabase'
import { trackEvent } from '../lib/analytics'
import { recordCompletedGame, type PlayerProgress } from '../lib/progression'
import {
  completeDailyChallenge,
  fetchDailyLeaderboard,
  getDailyChallenge,
  type DailyLeaderboardEntry,
} from '../api/dailyChallenges'

interface Props {
  score: number
  results: RoundResult[]
  artistSlug: string | null
  category: Category | null
  gameKind: 'solo' | 'daily'
  dailyKey: string | null
  onPlayAgain: () => void
  onHome: () => void
}

export function ResultsScreen({
  score,
  results,
  artistSlug,
  category,
  gameKind,
  dailyKey,
  onPlayAgain,
  onHome,
}: Props) {
  const correctCount = results.filter((r) => r.correct).length
  const maxScore = results.length * 1000

  const [name, setName] = useState(() => localStorage.getItem(DISPLAY_NAME_KEY) ?? '')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loadingScores, setLoadingScores] = useState(true)
  const [progress, setProgress] = useState<PlayerProgress | null>(null)
  const completionRecorded = useRef(false)
  const [dailyLeaderboard, setDailyLeaderboard] = useState<DailyLeaderboardEntry[]>([])
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null)

  const canUseLeaderboard = isSupabaseConfigured && Boolean(artistSlug && category)

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

  useEffect(() => {
    if (completionRecorded.current) return
    completionRecorded.current = true
    setProgress(recordCompletedGame({
      score,
      category,
      correctCount,
      rounds: results.length,
      daily: gameKind === 'daily',
      dateKey: dailyKey ?? undefined,
    }))
    trackEvent(gameKind === 'daily' ? 'daily_completed' : 'game_completed', {
      score,
      correct: correctCount,
      rounds: results.length,
    })
  }, [correctCount, dailyKey, gameKind, results.length, score])

  useEffect(() => {
    if (
      gameKind !== 'daily' ||
      !dailyKey ||
      !artistSlug ||
      !category ||
      !isSupabaseConfigured
    ) return
    const challengeDate = dailyKey
    const challengeArtist = artistSlug
    const challengeCategory = category
    let cancelled = false
    async function saveAndLoadDailyLeaderboard() {
      try {
        const challenge = await getDailyChallenge(challengeDate, challengeArtist, challengeCategory)
        await completeDailyChallenge({
          challengeId: challenge.id,
          points: score,
          correctCount,
        })
        const entries = await fetchDailyLeaderboard(challenge.id)
        if (!cancelled) setDailyLeaderboard(entries)
      } catch {
        // Local streaks and sharing remain available until the optional migration is applied.
        if (!cancelled) setDailyLeaderboardError('Онлайн өдөр тутмын самбар одоогоор бэлэн биш байна.')
      }
    }
    void saveAndLoadDailyLeaderboard()
    return () => {
      cancelled = true
    }
  }, [artistSlug, category, correctCount, dailyKey, gameKind, score])

  async function shareResult() {
    const label = gameKind === 'daily' ? 'Өнөөдрийн сорил' : 'Таа'
    const url = new URL(window.location.origin)
    if (gameKind === 'daily') {
      url.searchParams.set('daily', '1')
      if (category) url.searchParams.set('category', category)
      if (artistSlug) url.searchParams.set('pack', artistSlug)
    }
    const text = `${label}: ${score.toLocaleString()} оноо · ${correctCount}/${results.length} зөв. Чи намайг гүйцэх үү?`
    try {
      if (navigator.share) await navigator.share({ title: 'Таа', text, url: url.toString() })
      else await navigator.clipboard.writeText(`${text} ${url}`)
      trackEvent('result_shared', { game: gameKind, score })
    } catch {
      // A cancelled native share is not an error worth showing during a game.
    }
  }

  async function handleSave() {
    if (!artistSlug || !category || !name.trim() || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const trimmed = name.trim()
      const entry = await saveScore({
        playerName: trimmed,
        artistSlug,
        category,
        points: score,
        correctCount,
        rounds: results.length,
      })
      localStorage.setItem(DISPLAY_NAME_KEY, trimmed)
      try {
        await updateDisplayName(trimmed)
      } catch {
        // Profile migration may not be applied yet.
      }
      setSavedId(entry.id)
      const list = await fetchTopScores(artistSlug)
      setScores(list)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const hasSidebar = canUseLeaderboard || gameKind === 'daily'

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
      <div className={`grid gap-6 ${hasSidebar ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
        {/* Left: score + round breakdown + actions */}
        <div className="animate-fade-up">
          <EqualizerBars className="mb-5 h-8" />
          <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-2">
            Тоглоом дууслаа
          </div>
          <div className="mt-2 bg-gradient-to-br from-pink via-purple to-cyan bg-clip-text text-6xl font-black leading-none text-transparent sm:text-7xl">
            {score.toLocaleString()}
          </div>
          <div className="mt-2.5 text-sm text-muted">
            {correctCount} / {results.length} зөв · дээд оноо {maxScore.toLocaleString()}
          </div>
          {gameKind === 'daily' && (
            <div className="mt-4 inline-block rounded-full border border-cyan/30 bg-cyan/10 px-4 py-2 text-sm font-bold text-cyan">
              Өнөөдрийн сорил {progress && `· 🔥 ${progress.dailyStreak} өдөр`}
            </div>
          )}

          {/* Round breakdown */}
          <div className="mt-8 text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
            Раундын дүн
          </div>
          <div className="mt-3.5 space-y-2.5">
            {results.map((r) => (
              <div
                key={r.roundIndex}
                className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface px-4 py-3.5"
              >
                <span className="w-6 text-xs font-extrabold text-muted-2">Р{r.roundIndex + 1}</span>
                <span
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-extrabold ${
                    r.correct ? 'bg-accent-green/15 text-accent-green' : 'bg-pink/15 text-pink'
                  }`}
                >
                  {r.correct ? '✓' : '✕'}
                </span>
                <span className={`flex-1 truncate text-sm ${r.correct ? 'text-ink-soft' : 'text-muted'}`}>
                  {r.answerTitle}
                </span>
                {r.hintUsed && <span className="text-xs text-amber">💡</span>}
                <span className={`text-sm font-extrabold ${r.points > 0 ? 'text-cyan' : 'text-muted-2'}`}>
                  +{r.points.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={onPlayAgain} className="flex-1">
              ↻ Дахин тоглох
            </Button>
            <Button variant="ghost" onClick={() => void shareResult()} className="flex-1">
              ↗ Хуваалцах
            </Button>
            <Button variant="ghost" onClick={onHome} className="flex-1">
              Нүүр
            </Button>
          </div>
        </div>

        {/* Right: save score + leaderboards */}
        {hasSidebar && (
          <div className="flex flex-col gap-5 lg:border-l lg:border-border lg:pl-6">
            {canUseLeaderboard && !savedId && (
              <div className="rounded-2xl border border-dashed border-border p-5 text-center">
                <div className="mb-3 text-sm text-muted">Онооны самбарт нэрээ бич</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  maxLength={24}
                  placeholder="Таны нэр"
                  className="mb-3 w-full rounded-xl border border-border bg-base px-4 py-3 text-center text-ink outline-none placeholder:text-muted-2 focus:border-cyan/60"
                />
                <Button onClick={handleSave} disabled={!name.trim() || saving} className="w-full">
                  {saving ? 'Хадгалж…' : 'Хадгалах'}
                </Button>
                {saveError && <p className="mt-2 text-sm text-pink">{saveError}</p>}
              </div>
            )}

            {gameKind === 'daily' && (
              <div>
                <div className="mb-3.5 text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
                  Өнөөдрийн тэргүүлэгчид
                </div>
                {dailyLeaderboard.length > 0 ? (
                  <div className="space-y-2">
                    {dailyLeaderboard.map((entry, index) => (
                      <div
                        key={`${entry.playerName}-${entry.completedAt}`}
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                      >
                        <span className="w-6 text-sm font-extrabold text-muted-2">{index + 1}</span>
                        <span className="flex-1 truncate text-sm font-semibold text-ink">{entry.playerName}</span>
                        <span className="text-sm font-extrabold text-cyan">{entry.points.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                ) : dailyLeaderboardError ? (
                  <p className="text-sm text-muted">{dailyLeaderboardError}</p>
                ) : (
                  <p className="text-sm text-muted">Тэргүүлэгчдийг ачааллаж байна…</p>
                )}
              </div>
            )}

            {canUseLeaderboard && (
              <div>
                <div className="mb-3.5 text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
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
                            isMine
                              ? 'border-pink bg-gradient-to-br from-pink/15 to-surface'
                              : 'border-border bg-surface'
                          }`}
                        >
                          <span
                            className={`w-6 text-sm font-black ${
                              i === 0 ? 'text-amber' : i === 1 ? 'text-ink-soft' : isMine ? 'text-pink' : 'text-muted-2'
                            }`}
                          >
                            {i + 1}
                          </span>
                          <span className="flex-1 truncate text-sm font-semibold text-ink">
                            {s.playerName}
                            {isMine && <span className="ml-1 text-xs font-normal text-muted"> · чи</span>}
                          </span>
                          <span className="text-xs text-muted-2">
                            {s.correctCount}/{s.rounds}
                          </span>
                          <span className="text-sm font-extrabold text-cyan">{s.points.toLocaleString()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
