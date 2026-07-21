import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { CategoryCard } from '../components/CategoryCard'
import { EqualizerBars } from '../components/EqualizerBars'
import { fetchCategories } from '../api/categories'
import { fetchArtists } from '../api/songs'
import { createRoom, joinRoom } from '../api/rooms'
import { isSupabaseConfigured } from '../lib/supabase'
import type { ArtistOption, Category, GameConfig, LeaderboardCategory, MultiSession } from '../types'

interface Props {
  onStart: (slug: string, category: Category, config: GameConfig) => void
  onEnterLobby: (session: MultiSession) => void
}

const MIN_SONGS = 4 // need at least 4 items to fill the answer options
const MAX_POINTS = 1000

const ROUND_OPTIONS = [3, 5, 10]
const TIME_OPTIONS = [10, 15, 20, 30]
const VISIBLE_CATEGORY_COUNT = 6

export function HomeScreen({ onStart, onEnterLobby }: Props) {
  const [categories, setCategories] = useState<LeaderboardCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [showMoreCategories, setShowMoreCategories] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [mode, setMode] = useState<'solo' | 'multi'>('solo')

  const [artists, setArtists] = useState<ArtistOption[]>([])
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
  const [loadingArtists, setLoadingArtists] = useState(true)
  const [artistError, setArtistError] = useState<string | null>(null)

  const [rounds, setRounds] = useState(5)
  const [timePerRound, setTimePerRound] = useState(15)
  const [nickname, setNickname] = useState('')
  const [joinPin, setJoinPin] = useState('')
  const [multiBusy, setMultiBusy] = useState(false)
  const [multiError, setMultiError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoadingCategories(false)
      return
    }
    let cancelled = false
    fetchCategories()
      .then((list) => {
        if (cancelled) return
        setCategories(list)
        setSelectedCategory(list[0]?.slug ?? null)
      })
      .catch((err) => !cancelled && setCategoryError(err.message))
      .finally(() => !cancelled && setLoadingCategories(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Load packs for the selected category (re-runs when the category changes).
  useEffect(() => {
    if (!isSupabaseConfigured || !selectedCategory) {
      setLoadingArtists(false)
      return
    }
    let cancelled = false
    setLoadingArtists(true)
    setArtistError(null)
    fetchArtists(selectedCategory)
      .then((list) => {
        if (cancelled) return
        setArtists(list)
        // Default to the first pack that has enough items to play.
        const firstPlayable = list.find((a) => a.songCount >= MIN_SONGS)
        setSelectedArtist(firstPlayable?.slug ?? null)
      })
      .catch((err) => !cancelled && setArtistError(err.message))
      .finally(() => !cancelled && setLoadingArtists(false))
    return () => {
      cancelled = true
    }
  }, [selectedCategory])

  const selectedCategoryData = categories.find((category) => category.slug === selectedCategory)
  const visibleCategories = categories.slice(0, VISIBLE_CATEGORY_COUNT)
  const overflowCategories = categories.slice(VISIBLE_CATEGORY_COUNT)
  const matchingOverflowCategories = overflowCategories.filter((category) =>
    `${category.name} ${category.slug}`.toLocaleLowerCase().includes(categorySearch.toLocaleLowerCase()),
  )
  const selected = artists.find((a) => a.slug === selectedArtist)
  const canStart = Boolean(selectedCategory && selected && selected.songCount >= MIN_SONGS)
  const hasNickname = nickname.trim().length >= 2

  async function handleCreateRoom() {
    if (!selectedArtist || !selectedCategory || !canStart || !hasNickname) return
    setMultiBusy(true)
    setMultiError(null)
    try {
      const result = await createRoom({
        hostNickname: nickname,
        artistSlug: selectedArtist,
        category: selectedCategory,
        config: { rounds, timePerRound, maxPoints: MAX_POINTS },
      })
      onEnterLobby(result.session)
    } catch (error) {
      setMultiError(error instanceof Error ? error.message : 'Өрөө үүсгэж чадсангүй.')
    } finally {
      setMultiBusy(false)
    }
  }

  async function handleJoinRoom() {
    if (!hasNickname || joinPin.replace(/\D/g, '').length !== 6) return
    setMultiBusy(true)
    setMultiError(null)
    try {
      const result = await joinRoom(joinPin, nickname)
      onEnterLobby(result.session)
    } catch (error) {
      setMultiError(error instanceof Error ? error.message : 'Өрөөнд нэвтэрч чадсангүй.')
    } finally {
      setMultiBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-10">
      {/* Hero */}
      <div className="mb-10 animate-fade-up">
        <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
          Дууг сонсоод <span className="text-pink">нэрийг нь</span> таа
        </h1>
        <p className="mt-3 max-w-md text-muted">
          Монгол уран бүтээлчдийн дуунуудыг таних тоглоом. Хурдан таавал өндөр оноо. Уран бүтээлчээ
          сонгоод эхэл.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="mb-6 inline-flex rounded-xl border border-border bg-surface p-1">
        <button
          onClick={() => setMode('solo')}
          className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
            mode === 'solo' ? 'bg-raised text-ink' : 'text-muted'
          }`}
        >
          Ганцаараа
        </button>
        <button
          onClick={() => setMode('multi')}
          className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
            mode === 'multi' ? 'bg-raised text-ink' : 'text-muted'
          }`}
        >
          Хамтдаа
        </button>
      </div>

      {mode === 'multi' && (
        <section className="mb-10 overflow-hidden rounded-3xl border border-pink/40 bg-surface shadow-2xl shadow-pink/10">
          <div className="bg-gradient-to-r from-pink/30 via-violet-500/20 to-cyan/20 px-6 py-6 text-center sm:px-10">
            <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-cyan">Live music quiz</p>
            <h2 className="mt-2 text-2xl font-extrabold text-ink sm:text-3xl">Өрөөний код оруулна уу</h2>
          </div>
          <div className="mx-auto max-w-xl p-5 sm:p-7">
            <div className="grid gap-3 sm:grid-cols-[1fr_0.85fr_auto] sm:items-end">
              <label className="block text-left text-sm font-bold text-muted" htmlFor="room-pin">
                Өрөөний код
                <input
                  id="room-pin"
                  value={joinPin}
                  onChange={(event) => setJoinPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="mt-2 w-full rounded-xl border-2 border-border bg-base px-3 py-3 text-center font-mono text-2xl font-extrabold tracking-[0.16em] text-ink outline-none placeholder:text-muted-2 focus:border-pink"
                />
              </label>
              <label className="block text-left text-sm font-bold text-muted" htmlFor="nickname">
                Таны нэр
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  maxLength={24}
                  placeholder="Таны нэр"
                  className="mt-2 w-full rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none focus:border-cyan/60"
                />
              </label>
              <Button
                className="w-full py-3.5 text-sm sm:w-auto sm:px-7"
                disabled={multiBusy || !hasNickname || joinPin.length !== 6}
                onClick={() => void handleJoinRoom()}
              >
                {multiBusy ? 'Нэгдэж байна…' : 'ОРОХ →'}
              </Button>
            </div>
            {multiError && <p className="mt-4 text-center text-sm font-bold text-pink">{multiError}</p>}
          </div>
        </section>
      )}

      {/* Category grid */}
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-2">Ангилал</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {loadingCategories ? (
          <div className="col-span-full flex items-center gap-3 text-muted">
            <EqualizerBars className="h-5" /> Ангиллуудыг ачааллаж байна…
          </div>
        ) : categoryError ? (
          <p className="col-span-full rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
            {categoryError}
          </p>
        ) : categories.length === 0 ? (
          <p className="col-span-full rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
            Идэвхтэй ангилал алга байна.
          </p>
        ) : visibleCategories.map((category) => (
          <CategoryCard
            key={category.slug}
            icon={category.icon}
            title={category.name}
            subtitle={category.subtitle}
            accent={category.accent}
            active
            selected={selectedCategory === category.slug}
            onSelect={() => setSelectedCategory(category.slug)}
          />
        ))}
        {!loadingCategories && overflowCategories.length > 0 && (
          <button
            onClick={() => {
              setShowMoreCategories((open) => !open)
              setCategorySearch('')
            }}
            className="rounded-2xl border-2 border-border bg-surface p-4 text-left text-sm font-bold text-muted transition hover:bg-raised hover:text-ink"
            aria-expanded={showMoreCategories}
          >
            Бусад ангилал ▾
          </button>
        )}
      </div>
      {showMoreCategories && (
        <div className="mt-3 rounded-2xl border border-border bg-surface p-3">
          <input
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Ангилал хайх"
            className="mb-3 w-full rounded-xl border border-border bg-base px-3 py-2 text-sm text-ink outline-none placeholder:text-muted-2 focus:border-cyan/60"
          />
          <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {matchingOverflowCategories.map((category) => (
              <CategoryCard
                key={category.slug}
                icon={category.icon}
                title={category.name}
                subtitle={category.subtitle}
                accent={category.accent}
                active
                selected={selectedCategory === category.slug}
                onSelect={() => {
                  setSelectedCategory(category.slug)
                  setShowMoreCategories(false)
                  setCategorySearch('')
                }}
              />
            ))}
            {matchingOverflowCategories.length === 0 && (
              <p className="col-span-full px-2 py-3 text-sm text-muted">Ангилал олдсонгүй.</p>
            )}
          </div>
        </div>
      )}

      {/* Pack picker */}
      <div className="mb-4 mt-10 text-xs font-bold uppercase tracking-widest text-muted-2">
        {selectedCategoryData?.pickerLabel ?? 'Багц'}
      </div>
      {loadingArtists ? (
        <div className="flex items-center gap-3 text-muted">
          <EqualizerBars className="h-5" /> Ачааллаж байна…
        </div>
      ) : artistError ? (
        <p className="rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {artistError}
        </p>
      ) : artists.length === 0 ? (
        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          {selectedCategoryData?.emptyMessage ?? 'Багц алга байна.'} <code>npm run ingest</code>{' '}
          ажиллуулж нэмнэ үү.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {artists.map((a) => {
            const playable = a.songCount >= MIN_SONGS
            const isSel = selectedArtist === a.slug
            return (
              <button
                key={a.id}
                disabled={!playable}
                onClick={() => setSelectedArtist(a.slug)}
                className={`flex flex-col gap-1 rounded-2xl border-2 p-4 text-left transition
                  ${
                    playable
                      ? isSel
                        ? 'border-pink bg-raised'
                        : 'border-border bg-surface hover:bg-raised'
                      : 'cursor-not-allowed border-border/50 bg-surface/40 opacity-60'
                  }`}
              >
                <span className="text-base font-bold text-ink" style={{ color: '#f2f4f8' }}>
                  {a.name}
                </span>
                <span className="text-xs text-muted">
                  {a.songCount} {selectedCategoryData?.itemLabel ?? 'асуулт'}
                  {playable ? '' : ` · дор хаяж ${MIN_SONGS} хэрэгтэй`}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {!isSupabaseConfigured && (
        <p className="mt-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          ⚠ Supabase тохируулаагүй байна. <code>.env.example</code>-г <code>.env.local</code> болгож
          хуулаад төслийн URL, anon key-ээ оруулна уу.
        </p>
      )}

      {/* Settings (Тохиргоо) */}
      <div className="mb-4 mt-10 text-xs font-bold uppercase tracking-widest text-muted-2">
        Тохиргоо
      </div>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:gap-10">
        <Segmented
          label="Раунд"
          options={ROUND_OPTIONS}
          value={rounds}
          onChange={setRounds}
        />
        <Segmented
          label="Хугацаа"
          options={TIME_OPTIONS}
          value={timePerRound}
          onChange={setTimePerRound}
          suffix="с"
        />
      </div>

      {mode === 'solo' ? (
        <div className="mt-10">
          <Button
            onClick={() =>
              selectedArtist &&
              selectedCategory &&
              onStart(selectedArtist, selectedCategory, { rounds, timePerRound, maxPoints: MAX_POINTS })
            }
            disabled={!canStart}
            className="w-full py-4 text-base sm:w-auto sm:px-12"
          >
            ▶ {selected ? `${selected.name}-тэй тоглох` : 'Тоглоом эхлүүлэх'}
          </Button>
        </div>
      ) : (
        <section className="mt-10 rounded-3xl border border-border bg-surface p-5 sm:p-7">
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-base/60 p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/15 text-xl">✦</span>
              <div>
                <h2 className="font-extrabold text-ink">Өөрийн өрөөг нээх</h2>
                <p className="text-sm text-muted">Тохиргоогоо сонгоод найзуудаа урь.</p>
              </div>
            </div>
            <label className="block text-sm font-bold text-muted" htmlFor="host-nickname">
              Хөтлөгчийн нэр
            </label>
            <input
              id="host-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={24}
              placeholder="Таны нэр"
              className="mt-2 w-full rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none focus:border-cyan/60"
            />
            <Button
              className="mt-5 w-full py-4 text-base"
              disabled={multiBusy || !hasNickname || !canStart}
              onClick={() => void handleCreateRoom()}
            >
              {multiBusy ? 'Өрөө нээж байна…' : 'ӨРӨӨ ҮҮСГЭХ →'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function Segmented({
  label,
  options,
  value,
  onChange,
  suffix = '',
}: {
  label: string
  options: number[]
  value: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold tracking-widest text-muted-2">{label}</div>
      <div className="inline-flex rounded-xl border border-border bg-base p-1">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              value === opt ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {opt}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  )
}
