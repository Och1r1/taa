import { useEffect, useState } from 'react'
import type { Category, LeaderboardCategory, ScoreEntry } from '../types'
import { EqualizerBars } from '../components/EqualizerBars'
import { fetchCategories } from '../api/categories'
import { fetchTopScoresForCategory, type ScoreModeFilter } from '../api/scores'
import { isSupabaseConfigured } from '../lib/supabase'

const RANK = ['🥇', '🥈', '🥉']
const VISIBLE_CATEGORY_COUNT = 5

type ModeFilter = 'all' | ScoreModeFilter
type PeriodFilter = 'all' | 'season'

const MODE_FILTERS: { id: ModeFilter; label: string }[] = [
  { id: 'all', label: 'Бүгд' },
  { id: 'solo', label: 'Ганцаар' },
  { id: 'multi', label: 'Хамтдаа' },
]

/** Capitalize an artist slug for display (e.g. "morningstar" → "Morningstar"). */
function prettyArtist(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

export function LeaderboardScreen() {
  const [categories, setCategories] = useState<LeaderboardCategory[]>([])
  const [category, setCategory] = useState<Category | null>(() => categoryFromUrl())
  const [modeFilter, setModeFilter] = useState<ModeFilter>(() => modeFromUrl())
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => seasonFromUrl())
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCategoriesLoading(false)
      return
    }
    let cancelled = false
    fetchCategories()
      .then((list) => {
        if (cancelled) return
        setCategories(list)
        setCategory((current) => (list.some((item) => item.slug === current) ? current : list[0]?.slug ?? null))
      })
      .catch((err) => !cancelled && setCategoryError(err.message))
      .finally(() => !cancelled && setCategoriesLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !category) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    // Do not show the previous category's results while the new category is loading.
    setScores([])
    setHasMore(false)
    fetchTopScoresForCategory(category, {
      mode: modeFilter === 'all' ? undefined : modeFilter,
      since: periodFilter === 'season' ? seasonStart() : undefined,
    })
      .then((page) => {
        if (cancelled) return
        setScores(page.entries)
        setHasMore(page.hasMore)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [category, modeFilter, periodFilter])

  const selectedCategory = categories.find((item) => item.slug === category)
  const visibleCategories = categories.slice(0, VISIBLE_CATEGORY_COUNT)
  const overflowCategories = categories.slice(VISIBLE_CATEGORY_COUNT)
  const matchingOverflowCategories = overflowCategories.filter((item) =>
    `${item.name} ${item.slug}`.toLocaleLowerCase().includes(categorySearch.toLocaleLowerCase()),
  )

  function writeUrl(nextCategory: Category | null, nextMode: ModeFilter, nextPeriod = periodFilter) {
    const url = new URL(window.location.href)
    if (nextCategory) url.searchParams.set('category', nextCategory)
    else url.searchParams.delete('category')
    if (nextMode === 'all') url.searchParams.delete('mode')
    else url.searchParams.set('mode', nextMode)
    if (nextPeriod === 'all') url.searchParams.delete('season')
    else url.searchParams.set('season', 'current')
    window.history.replaceState({}, '', url)
  }

  function selectCategory(slug: Category) {
    setCategory(slug)
    setShowMore(false)
    setCategorySearch('')
    writeUrl(slug, modeFilter)
  }

  function selectMode(next: ModeFilter) {
    setModeFilter(next)
    writeUrl(category, next)
  }

  function selectPeriod(next: PeriodFilter) {
    setPeriodFilter(next)
    writeUrl(category, modeFilter, next)
  }

  async function loadMoreScores() {
    if (!category || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await fetchTopScoresForCategory(category, {
        offset: scores.length,
        mode: modeFilter === 'all' ? undefined : modeFilter,
        since: periodFilter === 'season' ? seasonStart() : undefined,
      })
      setScores((current) => [...current, ...page.entries])
      setHasMore(page.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-10">
      {/* Title */}
      <div className="mb-8 animate-fade-up">
        <h1 className="text-4xl font-extrabold leading-tight">
          🏆 <span className="text-amber">Тэргүүлэгчид</span>
        </h1>
        <p className="mt-2 text-muted">Ангилал бүрийн хамгийн өндөр оноо — ганцаараа болон хамтдаа.</p>
      </div>

      {categoriesLoading ? (
        <div className="mb-6 flex items-center gap-3 text-sm text-muted">
          <EqualizerBars className="h-4" /> Ангиллуудыг ачааллаж байна…
        </div>
      ) : categoryError ? (
        <p className="mb-6 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {categoryError}
        </p>
      ) : categories.length === 0 ? (
        <p className="mb-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          Идэвхтэй ангилал алга байна.
        </p>
      ) : (
        <div className="mb-6" aria-label="Ангилал сонгох">
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((item) => {
              const selected = item.slug === category
              return (
                <button
                  key={item.slug}
                  onClick={() => selectCategory(item.slug)}
                  className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                    selected
                      ? 'border-cyan/60 bg-cyan/10 text-ink'
                      : 'border-border bg-surface text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  {item.icon} {item.name}
                </button>
              )
            })}
            {overflowCategories.length > 0 && (
              <button
                onClick={() => {
                  setShowMore((open) => !open)
                  setCategorySearch('')
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  overflowCategories.some((item) => item.slug === category)
                    ? 'border-cyan/60 bg-cyan/10 text-ink'
                    : 'border-border bg-surface text-muted hover:bg-raised hover:text-ink'
                }`}
                aria-expanded={showMore}
              >
                Бусад ▾
              </button>
            )}
          </div>
          {showMore && (
            <div className="mt-2 rounded-2xl border border-border bg-surface p-3">
              <input
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                placeholder="Ангилал хайх"
                className="mb-3 w-full rounded-xl border border-border bg-base px-3 py-2 text-sm text-ink outline-none placeholder:text-muted-2 focus:border-cyan/60"
              />
              <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {matchingOverflowCategories.map((item) => (
                <button
                  key={item.slug}
                  onClick={() => selectCategory(item.slug)}
                  className={`rounded-xl px-3 py-2 text-left text-sm font-bold transition ${
                    item.slug === category ? 'bg-cyan/10 text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  {item.icon} {item.name}
                </button>
                ))}
                {matchingOverflowCategories.length === 0 && (
                  <p className="col-span-full px-2 py-3 text-sm text-muted">Ангилал олдсонгүй.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2" aria-label="Тоглоомын горим">
        {MODE_FILTERS.map((item) => {
          const selected = item.id === modeFilter
          return (
            <button
              key={item.id}
              onClick={() => selectMode(item.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                selected
                  ? 'border-pink/60 bg-pink/10 text-ink'
                  : 'border-border bg-surface text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="mb-6 flex flex-wrap gap-2" aria-label="Тэргүүлэгчдийн хугацаа">
        {([
          { id: 'all', label: 'Бүх цаг' },
          { id: 'season', label: 'Энэ сарын casual улирал' },
        ] as { id: PeriodFilter; label: string }[]).map((item) => (
          <button
            key={item.id}
            onClick={() => selectPeriod(item.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
              item.id === periodFilter
                ? 'border-amber/60 bg-amber/10 text-ink'
                : 'border-border bg-surface text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!isSupabaseConfigured ? (
        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          ⚠ Supabase тохируулаагүй байна.
        </p>
      ) : categoriesLoading ? null : !selectedCategory ? null : loading ? (
        <div className="flex items-center gap-3 text-muted">
          <EqualizerBars className="h-5" /> Ачааллаж байна…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {error}
        </p>
      ) : scores.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-muted">
          {selectedCategory.name} ангилалд оноо алга. Тоглоод эхний тэргүүлэгч бол! {selectedCategory.icon}
        </p>
      ) : (
        <>
          {periodFilter === 'season' && (
            <p className="mb-4 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
              Casual улирал: энэ нь найрсаг өрсөлдөөн бөгөөд оноо серверээр бүрэн баталгаажаагүй.
            </p>
          )}
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
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-base font-bold text-ink">{s.playerName}</div>
                    {s.mode === 'multi' && (
                      <span className="shrink-0 rounded-lg bg-pink/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-pink">
                        Хамтдаа
                      </span>
                    )}
                  </div>
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
          {hasMore && (
            <button
              onClick={loadMoreScores}
              disabled={loadingMore}
              className="mt-5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-bold text-muted transition hover:bg-raised hover:text-ink disabled:cursor-not-allowed"
            >
              {loadingMore ? 'Ачааллаж байна…' : 'Илүү оноо харах'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function categoryFromUrl(): Category | null {
  return new URLSearchParams(window.location.search).get('category')
}

function modeFromUrl(): ModeFilter {
  const value = new URLSearchParams(window.location.search).get('mode')
  if (value === 'solo' || value === 'multi') return value
  return 'all'
}

function seasonFromUrl(): PeriodFilter {
  return new URLSearchParams(window.location.search).get('season') === 'current' ? 'season' : 'all'
}

function seasonStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}
