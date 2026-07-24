import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { NicknameInput } from '../components/NicknameInput'
import { PillToggle } from '../components/PillToggle'
import { SectionLabel } from '../components/SectionLabel'
import { StatusMessage } from '../components/StatusMessage'
import { fetchCategories } from '../api/categories'
import { fetchArtists } from '../api/songs'
import { resolveDisplayName, updateDisplayName } from '../api/auth'
import { createRoom, joinRoom, listPublicLobbies, peekRoomByInvite, peekRoomByPin } from '../api/rooms'
import {
  clearJoinPinFromUrl,
  normalizeInviteSecret,
  normalizeJoinPin,
  readJoinParamsFromUrl,
} from '../lib/joinUrl'
import { isSupabaseConfigured, supabaseConfigurationError } from '../lib/supabase'
import { loadProgress } from '../lib/progression'
import type {
  ArtistOption,
  Category,
  GameConfig,
  LeaderboardCategory,
  MultiSession,
  PublicLobbyEntry,
  RoomVisibility,
} from '../types'

type ViewMode = 'solo' | 'host' | 'join'
type SortKey = 'popular' | 'new' | 'az' | 'easy'

interface Props {
  initialMode?: ViewMode
  onStart: (slug: string, category: Category, config: GameConfig) => void
  onStartDaily: (slug: string, category: Category, config: GameConfig) => void
  onEnterLobby: (session: MultiSession) => void
  onOpenAccount: () => void
}

const MIN_SONGS = 4 // need at least 4 items to fill the answer options
const MAX_POINTS = 1000

const ROUND_OPTIONS = [3, 5, 10, 15]
const TIME_OPTIONS = [10, 15, 20, 30, 45]
const LOBBY_REFRESH_MS = 15000

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: 'Алдартай' },
  { key: 'new', label: 'Шинэ' },
  { key: 'az', label: 'А–Я' },
  { key: 'easy', label: 'Хялбар' },
]

function dailyLinkParams(): { category: string | null; pack: string | null } {
  const params = new URLSearchParams(window.location.search)
  return params.get('daily') === '1'
    ? { category: params.get('category'), pack: params.get('pack') }
    : { category: null, pack: null }
}

function prettySlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

function initialViewMode(fallback: ViewMode): ViewMode {
  const join = readJoinParamsFromUrl()
  if (join.pin || join.invite || /^\/join(\/|$)/i.test(window.location.pathname)) return 'join'
  return fallback
}

export function HomeScreen({ initialMode = 'solo', onStart, onStartDaily, onEnterLobby }: Props) {
  const [{ category: sharedDailyCategory, pack: sharedDailyPack }] = useState(dailyLinkParams)
  const [categories, setCategories] = useState<LeaderboardCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => initialViewMode(initialMode))

  const [artists, setArtists] = useState<ArtistOption[]>([])
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
  const [loadingArtists, setLoadingArtists] = useState(true)
  const [artistError, setArtistError] = useState<string | null>(null)
  const [artistSearch, setArtistSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('popular')

  const [rounds, setRounds] = useState(5)
  const [timePerRound, setTimePerRound] = useState(20)
  const [showSettings, setShowSettings] = useState(false)
  const [nickname, setNickname] = useState('')
  const [joinPin, setJoinPin] = useState(() => readJoinParamsFromUrl().pin ?? '')
  const [joinInvite, setJoinInvite] = useState(() => readJoinParamsFromUrl().invite ?? '')
  const [roomVisibility, setRoomVisibility] = useState<RoomVisibility>('public')
  const [multiBusy, setMultiBusy] = useState(false)
  const [multiError, setMultiError] = useState<string | null>(null)
  const [joinLinkError, setJoinLinkError] = useState<string | null>(null)
  const [acceptsPlayers, setAcceptsPlayers] = useState(true)
  const [acceptsSpectators, setAcceptsSpectators] = useState(true)
  const [publicLobbies, setPublicLobbies] = useState<PublicLobbyEntry[]>([])
  const [loadingLobbies, setLoadingLobbies] = useState(false)
  const [lobbyListError, setLobbyListError] = useState<string | null>(null)
  const [progress] = useState(loadProgress)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void resolveDisplayName().then((name) => {
      if (!cancelled && name) setNickname(name)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || viewMode !== 'join' || joinInvite) {
      return
    }

    let cancelled = false

    async function loadLobbies() {
      setLoadingLobbies(true)
      try {
        const list = await listPublicLobbies()
        if (!cancelled) {
          setPublicLobbies(list)
          setLobbyListError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setLobbyListError(err instanceof Error ? err.message : 'Өрөөнүүдийг татаж чадсангүй')
        }
      } finally {
        if (!cancelled) setLoadingLobbies(false)
      }
    }

    void loadLobbies()
    const id = window.setInterval(() => void loadLobbies(), LOBBY_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [viewMode, joinInvite])

  // Consume deep link once: keep PIN/invite in the form, clean the address bar.
  useEffect(() => {
    const join = readJoinParamsFromUrl()
    if (!join.pin && !join.invite) {
      if (/^\/join(\/|$)/i.test(window.location.pathname)) {
        setJoinLinkError('Холбоос буруу байна. PIN эсвэл урилгын холбоос ашиглана уу.')
        clearJoinPinFromUrl()
      }
      return
    }
    if (join.pin) setJoinPin(join.pin)
    if (join.invite) setJoinInvite(join.invite)
    setJoinLinkError(null)
    clearJoinPinFromUrl()

    let cancelled = false
    void (async () => {
      try {
        const peek = join.invite
          ? await peekRoomByInvite(join.invite)
          : await peekRoomByPin(join.pin!)
        if (cancelled) return
        setJoinPin(peek.pin)
        if (peek.inviteSecret) setJoinInvite(peek.inviteSecret)
        setAcceptsPlayers(peek.acceptsPlayers)
        setAcceptsSpectators(peek.acceptsSpectators)
      } catch (err) {
        if (!cancelled) {
          setJoinLinkError(err instanceof Error ? err.message : 'Холбоос буруу байна')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
        const sharedCategoryExists = list.some((category) => category.slug === sharedDailyCategory)
        setSelectedCategory(sharedCategoryExists ? sharedDailyCategory : list[0]?.slug ?? null)
      })
      .catch((err) => !cancelled && setCategoryError(err.message))
      .finally(() => !cancelled && setLoadingCategories(false))
    return () => {
      cancelled = true
    }
  }, [sharedDailyCategory])

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
        const sharedPack = list.find((artist) => artist.slug === sharedDailyPack && artist.songCount >= MIN_SONGS)
        const firstPlayable = list.find((artist) => artist.songCount >= MIN_SONGS)
        setSelectedArtist(sharedPack?.slug ?? firstPlayable?.slug ?? null)
      })
      .catch((err) => !cancelled && setArtistError(err.message))
      .finally(() => !cancelled && setLoadingArtists(false))
    return () => {
      cancelled = true
    }
  }, [selectedCategory, sharedDailyPack])

  const selectedCategoryData = categories.find((category) => category.slug === selectedCategory)
  const selected = artists.find((a) => a.slug === selectedArtist)
  const canStart = Boolean(selectedCategory && selected && selected.songCount >= MIN_SONGS)
  const hasNickname = nickname.trim().length >= 2

  const visibleArtists = artists
    .filter((a) => a.name.toLocaleLowerCase().includes(artistSearch.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      if (sort === 'az') return a.name.localeCompare(b.name)
      if (sort === 'easy') return b.songCount - a.songCount
      if (sort === 'new') return artists.indexOf(b) - artists.indexOf(a)
      return 0 // popular = source order
    })

  async function persistDisplayName(raw: string) {
    const trimmed = raw.trim().slice(0, 24)
    if (trimmed.length < 2) return
    try {
      await updateDisplayName(trimmed)
    } catch {
      // Room actions can still proceed; profile SQL may not be applied yet.
    }
  }

  async function handleCreateRoom() {
    if (!selectedArtist || !selectedCategory || !canStart || !hasNickname) return
    setMultiBusy(true)
    setMultiError(null)
    try {
      await persistDisplayName(nickname)
      const result = await createRoom({
        hostNickname: nickname,
        artistSlug: selectedArtist,
        category: selectedCategory,
        config: { rounds, timePerRound, maxPoints: MAX_POINTS },
        visibility: roomVisibility,
      })
      onEnterLobby(result.session)
    } catch (error) {
      setMultiError(error instanceof Error ? error.message : 'Өрөө үүсгэж чадсангүй.')
    } finally {
      setMultiBusy(false)
    }
  }

  async function handleJoinRoom(asSpectator = false, pinOverride?: string) {
    const pin = normalizeJoinPin(pinOverride ?? joinPin)
    const invite = pinOverride ? '' : normalizeInviteSecret(joinInvite)
    if (!hasNickname || (!pin && !invite)) return
    setMultiBusy(true)
    setMultiError(null)
    setJoinLinkError(null)
    try {
      await persistDisplayName(nickname)
      const result = await joinRoom({
        pin,
        invite,
        nickname,
        asSpectator,
      })
      onEnterLobby(result.session)
    } catch (error) {
      setMultiError(error instanceof Error ? error.message : 'Өрөөнд нэвтэрч чадсангүй.')
    } finally {
      setMultiBusy(false)
    }
  }

  function handleSelectLobby(pin: string) {
    setJoinPin(pin)
    setJoinInvite('')
    if (hasNickname) void handleJoinRoom(false, pin)
  }

  const heroTitle =
    viewMode === 'join'
      ? 'Найзын өрөөнд нэгд'
      : viewMode === 'host'
        ? 'Өрөө нээж найзаа урь'
        : 'Дууг сонсоод'
  const heroSubtitle =
    viewMode === 'join'
      ? 'PIN эсвэл нээлттэй лоббиос сонгож ор.'
      : viewMode === 'host'
        ? 'Ангилал, дуучнаа сонгоод өрөө үүсгэ.'
        : 'Ангиллаа сонгоод, дуучнаа хайж эхэл.'

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
      {/* Hero */}
      <div className="animate-fade-up">
        <h1 className="text-[32px] font-black leading-[1.05] tracking-tight text-ink sm:text-[38px]">
          {viewMode === 'solo' ? (
            <>
              Дууг сонсоод{' '}
              <span className="bg-gradient-to-br from-pink to-purple bg-clip-text text-transparent">
                нэрийг нь
              </span>{' '}
              таа
            </>
          ) : (
            heroTitle
          )}
        </h1>
        <p className="mt-2.5 max-w-lg text-sm text-muted">{heroSubtitle}</p>
      </div>

      {!isSupabaseConfigured && (
        <StatusMessage variant="warning" className="mt-6">
          ⚠ {supabaseConfigurationError}
        </StatusMessage>
      )}

      {viewMode === 'join' ? (
        <JoinPanel
          categories={categories}
          joinInvite={joinInvite}
          joinPin={joinPin}
          setJoinPin={setJoinPin}
          nickname={nickname}
          setNickname={setNickname}
          hasNickname={hasNickname}
          multiBusy={multiBusy}
          acceptsPlayers={acceptsPlayers}
          acceptsSpectators={acceptsSpectators}
          publicLobbies={publicLobbies}
          loadingLobbies={loadingLobbies}
          lobbyListError={lobbyListError}
          setLobbyListError={setLobbyListError}
          setPublicLobbies={setPublicLobbies}
          onSelectLobby={handleSelectLobby}
          onJoin={handleJoinRoom}
          joinLinkError={joinLinkError}
          multiError={multiError}
        />
      ) : (
        <>
          {/* CATEGORY RAIL */}
          <div className="mb-3 mt-8 flex items-center justify-between">
            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
              Ангилал <span className="text-border">· {categories.length}</span>
            </div>
            <div className="hidden gap-2 sm:flex">
              <RailArrow dir="left" onClick={() => railRef.current?.scrollBy({ left: -320, behavior: 'smooth' })} />
              <RailArrow dir="right" onClick={() => railRef.current?.scrollBy({ left: 320, behavior: 'smooth' })} />
            </div>
          </div>
          {loadingCategories ? (
            <div className="flex items-center gap-3 text-muted">
              <EqualizerBars className="h-5" /> Ангиллуудыг ачааллаж байна…
            </div>
          ) : categoryError ? (
            <StatusMessage variant="error">{categoryError}</StatusMessage>
          ) : categories.length === 0 ? (
            <StatusMessage variant="warning">Идэвхтэй ангилал алга байна.</StatusMessage>
          ) : (
            <div ref={railRef} className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
              {categories.map((category) => {
                const active = selectedCategory === category.slug
                return (
                  <button
                    key={category.slug}
                    onClick={() => setSelectedCategory(category.slug)}
                    className="flex w-[150px] flex-none flex-col rounded-2xl border-2 p-4 text-left transition"
                    style={{
                      borderColor: active ? category.accent : '#2a3040',
                      background: active ? '#1b1f2a' : '#0d1119',
                      boxShadow: active ? `0 0 0 1px ${category.accent}55` : undefined,
                    }}
                  >
                    <span
                      className="mb-3 grid h-11 w-11 place-items-center rounded-xl text-xl"
                      style={{ background: `${category.accent}26` }}
                    >
                      {category.icon}
                    </span>
                    <span className="font-extrabold text-ink">{category.name}</span>
                    <span className="mt-0.5 text-xs text-muted">{category.subtitle}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ARTIST BROWSER */}
          <div className="mb-3 mt-7 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
                {selectedCategoryData?.pickerLabel ?? 'Багц'}
              </span>
              <span className="text-xs font-semibold text-border">
                {artists.length} {selectedCategoryData?.itemLabel ?? 'багц'}
              </span>
            </div>
            <div className="relative w-full sm:w-72">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6b7488"
                strokeWidth={2}
                className="pointer-events-none absolute left-3.5 top-3"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                value={artistSearch}
                onChange={(event) => setArtistSearch(event.target.value)}
                placeholder="Нэрээр хайх…"
                className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-ink outline-none placeholder:text-muted-2 focus:border-cyan/60"
              />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {SORTS.map((option) => {
              const on = sort === option.key
              return (
                <button
                  key={option.key}
                  onClick={() => setSort(option.key)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                    on
                      ? 'border-transparent bg-ink text-base'
                      : 'border-border bg-surface text-muted hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {loadingArtists ? (
            <div className="flex items-center gap-3 text-muted">
              <EqualizerBars className="h-5" /> Ачааллаж байна…
            </div>
          ) : artistError ? (
            <StatusMessage variant="error">{artistError}</StatusMessage>
          ) : artists.length === 0 ? (
            <StatusMessage variant="warning">
              {selectedCategoryData?.emptyMessage ?? 'Багц алга байна.'} <code>npm run ingest</code>{' '}
              ажиллуулж нэмнэ үү.
            </StatusMessage>
          ) : visibleArtists.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
              «{artistSearch}» олдсонгүй.
            </p>
          ) : (
            <div className="grid max-h-[340px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
              {visibleArtists.map((a) => {
                const playable = a.songCount >= MIN_SONGS
                const on = selectedArtist === a.slug
                return (
                  <button
                    key={a.id}
                    disabled={!playable}
                    onClick={() => setSelectedArtist(a.slug)}
                    className={`rounded-2xl border-2 p-4 text-left transition ${
                      !playable
                        ? 'cursor-not-allowed border-border/50 bg-surface/40 opacity-60'
                        : on
                          ? 'border-pink bg-raised'
                          : 'border-border bg-surface hover:bg-raised'
                    }`}
                    style={on && playable ? { boxShadow: '0 0 0 1px #ec489955' } : undefined}
                  >
                    <div className="font-bold text-ink">{a.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {a.songCount} {selectedCategoryData?.itemLabel ?? 'асуулт'}
                      {playable ? '' : ` · дор хаяж ${MIN_SONGS}`}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {viewMode === 'solo' ? (
            <>
              {/* Solo + multiplayer cards */}
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                <div className="flex flex-col rounded-3xl border border-border bg-surface p-7">
                  <div className="flex items-center gap-2.5 text-muted">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21v-1a6 6 0 0 1 12 0v1" />
                    </svg>
                    <span className="text-xs font-extrabold uppercase tracking-[0.14em]">Ганцаараа</span>
                  </div>
                  <div className="mt-3 text-2xl font-black tracking-tight text-ink">
                    {selected ? `${selected.name} · ${rounds} раунд` : 'Дуучнаа сонго'}
                  </div>
                  <div className="mt-1 text-[13px] text-muted">
                    {timePerRound} секунд ·{' '}
                    <button
                      onClick={() => setShowSettings((open) => !open)}
                      className="font-semibold text-cyan hover:underline"
                    >
                      тохиргоо өөрчлөх
                    </button>
                  </div>
                  <Button
                    onClick={() =>
                      selectedArtist &&
                      selectedCategory &&
                      onStart(selectedArtist, selectedCategory, { rounds, timePerRound, maxPoints: MAX_POINTS })
                    }
                    disabled={!canStart}
                    className="mt-7 self-start px-8 py-4 text-base"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4l14 8-14 8z" />
                    </svg>
                    Тоглох
                  </Button>
                </div>

                <div className="relative flex flex-col overflow-hidden rounded-3xl border border-pink/40 bg-gradient-to-br from-pink/25 to-indigo/20 p-7">
                  <div className="flex items-center gap-2.5 text-cyan">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9.5" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    </svg>
                    <span className="text-xs font-extrabold uppercase tracking-[0.14em]">Хамтдаа · Live</span>
                  </div>
                  <div className="mt-3 text-2xl font-black tracking-tight text-ink">Найзуудтайгаа өрсөлд</div>
                  <div className="mt-1 text-[13px] text-ink-soft">
                    Өрөө нээ, PIN хуваалц — 20 хүн зэрэг таана
                  </div>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <Button onClick={() => setViewMode('host')} className="px-6 py-3.5 text-sm">
                      Өрөө нээх →
                    </Button>
                    <Button variant="ghost" onClick={() => setViewMode('join')} className="px-5 py-3.5 text-sm">
                      Кодоор орох
                    </Button>
                  </div>
                </div>
              </div>

              {showSettings && (
                <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:gap-10">
                  <div>
                    <SectionLabel className="mb-2">Раунд</SectionLabel>
                    <PillToggle
                      value={rounds}
                      onChange={setRounds}
                      options={ROUND_OPTIONS.map((opt) => ({ value: opt, label: String(opt) }))}
                    />
                  </div>
                  <div>
                    <SectionLabel className="mb-2">Хугацаа</SectionLabel>
                    <PillToggle
                      value={timePerRound}
                      onChange={setTimePerRound}
                      options={TIME_OPTIONS.map((opt) => ({ value: opt, label: `${opt}с` }))}
                    />
                  </div>
                </div>
              )}

              {/* Daily challenge */}
              <button
                onClick={() =>
                  selectedArtist &&
                  selectedCategory &&
                  onStartDaily(selectedArtist, selectedCategory, {
                    rounds: 5,
                    timePerRound,
                    maxPoints: MAX_POINTS,
                  })
                }
                disabled={!canStart}
                className="mt-4 flex items-center gap-2 text-xs text-muted transition hover:text-ink disabled:opacity-50"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={2}>
                  <path d="M12 2c1 3-1 5-1 5s3 0 4 3c1 3-1 6-3 7 0 0 2-3 0-5-1 3-4 2-4 5 0 2 2 3 2 3-4 0-6-3-6-6 0-5 5-6 5-9 0-2 3-3 3-3Z" />
                </svg>
                Өнөөдрийн сорил · {progress.dailyStreak} өдрийн цуврал
                <span className="font-semibold text-cyan">эхлэх →</span>
              </button>
            </>
          ) : (
            /* Host settings */
            <section className="mt-7 max-w-xl">
              <div className="rounded-3xl border border-border bg-surface p-6">
                <NicknameInput
                  id="host-nickname"
                  label="Хөтлөгчийн нэр"
                  value={nickname}
                  onChange={setNickname}
                />
                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:gap-8">
                  <div>
                    <SectionLabel className="mb-2">Раунд</SectionLabel>
                    <PillToggle
                      value={rounds}
                      onChange={setRounds}
                      options={ROUND_OPTIONS.map((opt) => ({ value: opt, label: String(opt) }))}
                    />
                  </div>
                  <div>
                    <SectionLabel className="mb-2">Хугацаа</SectionLabel>
                    <PillToggle
                      value={timePerRound}
                      onChange={setTimePerRound}
                      options={TIME_OPTIONS.map((opt) => ({ value: opt, label: `${opt}с` }))}
                    />
                  </div>
                </div>
                <div className="mt-5">
                  <SectionLabel className="mb-2">Харагдац</SectionLabel>
                  <PillToggle
                    value={roomVisibility}
                    onChange={setRoomVisibility}
                    options={[
                      { value: 'public', label: 'Нийтийн PIN' },
                      { value: 'private', label: 'Хувийн урилга' },
                    ]}
                  />
                  <p className="mt-2 text-xs text-muted">
                    {roomVisibility === 'private'
                      ? 'Зөвхөн урилгын холбоосоор нэгдэнэ. PIN-аар орж болохгүй.'
                      : 'Найзууд PIN эсвэл QR-аар нэгдэнэ.'}
                  </p>
                </div>
                <Button
                  className="mt-6 w-full py-4 text-base"
                  disabled={multiBusy || !hasNickname || !canStart}
                  onClick={() => void handleCreateRoom()}
                >
                  {multiBusy ? 'Өрөө нээж байна…' : 'Өрөө үүсгэх →'}
                </Button>
                {multiError && (
                  <StatusMessage className="mt-4 text-center font-bold">{multiError}</StatusMessage>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function RailArrow({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'left' ? 'Буцах' : 'Дараах'}
      className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:text-ink"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        {dir === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
      </svg>
    </button>
  )
}

interface JoinPanelProps {
  categories: LeaderboardCategory[]
  joinInvite: string
  joinPin: string
  setJoinPin: (value: string) => void
  nickname: string
  setNickname: (value: string) => void
  hasNickname: boolean
  multiBusy: boolean
  acceptsPlayers: boolean
  acceptsSpectators: boolean
  publicLobbies: PublicLobbyEntry[]
  loadingLobbies: boolean
  lobbyListError: string | null
  setLobbyListError: (value: string | null) => void
  setPublicLobbies: (value: PublicLobbyEntry[]) => void
  onSelectLobby: (pin: string) => void
  onJoin: (asSpectator: boolean) => void
  joinLinkError: string | null
  multiError: string | null
}

function JoinPanel({
  categories,
  joinInvite,
  joinPin,
  setJoinPin,
  nickname,
  setNickname,
  hasNickname,
  multiBusy,
  acceptsPlayers,
  acceptsSpectators,
  publicLobbies,
  loadingLobbies,
  lobbyListError,
  setLobbyListError,
  setPublicLobbies,
  onSelectLobby,
  onJoin,
  joinLinkError,
  multiError,
}: JoinPanelProps) {
  const disabledJoin = multiBusy || !hasNickname || (!joinInvite && joinPin.length !== 6)
  return (
    <section className="mt-8 max-w-2xl">
      {!joinInvite && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <SectionLabel className="mb-0">Идэвхтэй нээлттэй өрөөнүүд</SectionLabel>
            <button
              type="button"
              disabled={loadingLobbies}
              onClick={() => {
                setLobbyListError(null)
                void listPublicLobbies()
                  .then((list) => setPublicLobbies(list))
                  .catch((err) =>
                    setLobbyListError(err instanceof Error ? err.message : 'Өрөөнүүдийг татаж чадсангүй'),
                  )
              }}
              className="text-xs font-bold text-cyan hover:underline disabled:opacity-50"
            >
              {loadingLobbies ? 'Шинэчилж байна…' : 'Шинэчлэх'}
            </button>
          </div>
          {lobbyListError ? (
            <StatusMessage variant="error">{lobbyListError}</StatusMessage>
          ) : loadingLobbies && publicLobbies.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <EqualizerBars className="h-4" /> Өрөөнүүдийг хайж байна…
            </div>
          ) : publicLobbies.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              Одоогоор нээлттэй лобби алга. PIN оруулах эсвэл өөрөө өрөө нээнэ үү.
            </p>
          ) : (
            <ul className="space-y-2">
              {publicLobbies.map((lobby) => {
                const categoryName =
                  categories.find((item) => item.slug === lobby.category)?.name ?? lobby.category
                return (
                  <li key={lobby.id}>
                    <button
                      type="button"
                      disabled={multiBusy}
                      onClick={() => onSelectLobby(lobby.pin)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left transition hover:border-cyan/40 hover:bg-raised disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-bold text-ink">
                          {categoryName} · {prettySlug(lobby.artistSlug)}
                        </div>
                        <div className="text-xs text-muted">
                          {lobby.rounds} раунд · {lobby.timePerRound}с · {lobby.playerCount} тоглогч
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-extrabold tracking-wider text-cyan">
                        {lobby.pin}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-3xl border border-border bg-surface p-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_0.85fr] sm:items-end">
          <label className="block text-left text-sm font-bold text-muted" htmlFor="room-pin">
            Өрөөний код
            <input
              id="room-pin"
              value={joinPin}
              onChange={(event) => setJoinPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              disabled={Boolean(joinInvite)}
              className="mt-2 w-full rounded-xl border-2 border-border bg-base px-3 py-3 text-center font-mono text-2xl font-extrabold tracking-[0.16em] text-ink outline-none placeholder:text-muted-2 focus:border-pink disabled:opacity-60"
            />
          </label>
          <NicknameInput id="nickname" label="Таны нэр" value={nickname} onChange={setNickname} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            className="min-w-[8rem] flex-1 py-3.5 text-sm sm:flex-none sm:px-7"
            disabled={disabledJoin || !acceptsPlayers}
            onClick={() => onJoin(false)}
          >
            {multiBusy ? 'Нэгдэж байна…' : 'Тоглогчоор орох'}
          </Button>
          <Button
            variant="ghost"
            className="min-w-[8rem] flex-1 py-3.5 text-sm sm:flex-none sm:px-7"
            disabled={disabledJoin || !acceptsSpectators}
            onClick={() => onJoin(true)}
          >
            Үзэгчээр орох
          </Button>
        </div>
        {joinInvite && (
          <p className="mt-3 text-center text-xs text-muted">Хувийн урилгын холбоос илрүүлсэн.</p>
        )}
        {(joinLinkError || multiError) && (
          <StatusMessage className="mt-4 text-center font-bold">{joinLinkError ?? multiError}</StatusMessage>
        )}
      </div>
    </section>
  )
}
