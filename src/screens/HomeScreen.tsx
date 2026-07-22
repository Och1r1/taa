import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { CategoryCard } from '../components/CategoryCard'
import { EqualizerBars } from '../components/EqualizerBars'
import { NicknameInput } from '../components/NicknameInput'
import { PillToggle } from '../components/PillToggle'
import { SectionLabel } from '../components/SectionLabel'
import { SelectableCard } from '../components/SelectableCard'
import { StatusMessage } from '../components/StatusMessage'
import { fetchCategories } from '../api/categories'
import { fetchArtists } from '../api/songs'
import { getAuthEmail, resolveDisplayName, sendMagicLink, updateDisplayName } from '../api/auth'
import { createRoom, joinRoom, listPublicLobbies, peekRoomByInvite, peekRoomByPin } from '../api/rooms'
import {
  clearJoinPinFromUrl,
  normalizeInviteSecret,
  normalizeJoinPin,
  readJoinParamsFromUrl,
} from '../lib/joinUrl'
import { isSupabaseConfigured } from '../lib/supabase'
import type {
  ArtistOption,
  Category,
  GameConfig,
  LeaderboardCategory,
  MultiSession,
  PublicLobbyEntry,
  RoomVisibility,
} from '../types'

interface Props {
  onStart: (slug: string, category: Category, config: GameConfig) => void
  onEnterLobby: (session: MultiSession) => void
}

const MIN_SONGS = 4 // need at least 4 items to fill the answer options
const MAX_POINTS = 1000

const ROUND_OPTIONS = [3, 5, 10]
const TIME_OPTIONS = [10, 15, 20, 30]
const VISIBLE_CATEGORY_COUNT = 6
const LOBBY_REFRESH_MS = 15000

function prettySlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

export function HomeScreen({ onStart, onEnterLobby }: Props) {
  const [categories, setCategories] = useState<LeaderboardCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [showMoreCategories, setShowMoreCategories] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [mode, setMode] = useState<'solo' | 'multi'>(() => {
    const join = readJoinParamsFromUrl()
    return join.pin || join.invite || /^\/join(\/|$)/i.test(window.location.pathname)
      ? 'multi'
      : 'solo'
  })
  const [multiSubMode, setMultiSubMode] = useState<'join' | 'host'>(() => {
    const join = readJoinParamsFromUrl()
    return join.pin || join.invite || /^\/join(\/|$)/i.test(window.location.pathname)
      ? 'join'
      : 'host'
  })

  const [artists, setArtists] = useState<ArtistOption[]>([])
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
  const [loadingArtists, setLoadingArtists] = useState(true)
  const [artistError, setArtistError] = useState<string | null>(null)

  const [rounds, setRounds] = useState(5)
  const [timePerRound, setTimePerRound] = useState(15)
  const [nickname, setNickname] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [magicEmail, setMagicEmail] = useState('')
  const [magicBusy, setMagicBusy] = useState(false)
  const [magicMessage, setMagicMessage] = useState<string | null>(null)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
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

  useEffect(() => {
    let cancelled = false
    void resolveDisplayName().then((name) => {
      if (!cancelled && name) setNickname(name)
    })
    void getAuthEmail().then((email) => {
      if (!cancelled) setSignedInEmail(email)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || mode !== 'multi' || multiSubMode !== 'join' || joinInvite) {
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
  }, [mode, multiSubMode, joinInvite])

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

  async function persistDisplayName(raw: string) {
    const trimmed = raw.trim().slice(0, 24)
    if (trimmed.length < 2) return
    try {
      await updateDisplayName(trimmed)
    } catch {
      // Room actions can still proceed; profile SQL may not be applied yet.
    }
  }

  async function handleSaveProfile() {
    if (!hasNickname || profileSaving) return
    setProfileSaving(true)
    setProfileMessage(null)
    try {
      await updateDisplayName(nickname)
      setProfileMessage('Нэр хадгалагдлаа')
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Нэр хадгалж чадсангүй')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleMagicLink() {
    if (magicBusy) return
    setMagicBusy(true)
    setMagicMessage(null)
    try {
      await sendMagicLink(magicEmail)
      setMagicMessage('И-мэйл илгээлээ — холбоосоор нэвтэрнэ үү.')
    } catch (error) {
      setMagicMessage(error instanceof Error ? error.message : 'И-мэйл илгээж чадсангүй')
    } finally {
      setMagicBusy(false)
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

      <details className="mb-8 max-w-md rounded-2xl border border-border bg-surface/60 open:bg-surface">
        <summary className="cursor-pointer select-none px-5 py-4 text-sm font-bold text-muted hover:text-ink">
          Профайл — {hasNickname ? nickname : 'нэрээ тохируулах'}
        </summary>
        <div className="px-5 pb-5">
          <NicknameInput
            id="display-name"
            label="Таны нэр"
            value={nickname}
            onChange={(value) => {
              setNickname(value)
              setProfileMessage(null)
            }}
            background="surface"
            action={{
              label: 'Хадгалах',
              busy: profileSaving,
              disabled: !hasNickname || profileSaving,
              onClick: () => void handleSaveProfile(),
            }}
            message={
              profileMessage
                ? { text: profileMessage, tone: profileMessage.includes('хадгалагдлаа') ? 'success' : 'error' }
                : null
            }
          />
          <div className="mt-4 border-t border-border pt-4">
            {signedInEmail ? (
              <p className="text-sm text-muted">
                Нэвтэрсэн: <span className="font-bold text-ink">{signedInEmail}</span>
              </p>
            ) : (
              <>
                <label className="block text-sm font-bold text-muted" htmlFor="magic-email">
                  И-мэйлээр нэвтрэх (заавал биш)
                  <div className="mt-2 flex gap-2">
                    <input
                      id="magic-email"
                      type="email"
                      value={magicEmail}
                      onChange={(event) => {
                        setMagicEmail(event.target.value)
                        setMagicMessage(null)
                      }}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-ink outline-none focus:border-cyan/60"
                    />
                    <Button
                      variant="ghost"
                      className="shrink-0 px-4 py-3 text-sm"
                      disabled={magicBusy || !magicEmail.includes('@')}
                      onClick={() => void handleMagicLink()}
                    >
                      {magicBusy ? '…' : 'Илгээх'}
                    </Button>
                  </div>
                </label>
                {magicMessage && (
                  <p
                    className={`mt-2 text-sm ${
                      magicMessage.includes('илгээлээ') ? 'text-cyan' : 'text-pink'
                    }`}
                  >
                    {magicMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </details>

      {/* Mode toggle */}
      <PillToggle
        className="mb-6"
        background="surface"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'solo', label: 'Ганцаараа' },
          { value: 'multi', label: 'Хамтдаа' },
        ]}
      />

      {mode === 'multi' && (
        <>
          <PillToggle
            className="mb-6"
            value={multiSubMode}
            onChange={setMultiSubMode}
            options={[
              { value: 'join', label: 'Нэгдэх' },
              { value: 'host', label: 'Өрөө нээх' },
            ]}
          />

          {multiSubMode === 'join' && (
            <section className="mb-10 overflow-hidden rounded-3xl bg-surface">
              <div className="bg-gradient-to-r from-pink/30 via-violet-500/20 to-cyan/20 px-6 py-6 text-center sm:px-10">
                <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-cyan">Live music quiz</p>
                <h2 className="mt-2 text-2xl font-extrabold text-ink sm:text-3xl">
                  {joinInvite ? 'Урилгын холбоосоор нэгдэх' : 'Өрөөний код оруулна уу'}
                </h2>
              </div>
              <div className="mx-auto max-w-xl p-5 sm:p-7">
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
                              setLobbyListError(
                                err instanceof Error ? err.message : 'Өрөөнүүдийг татаж чадсангүй',
                              ),
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
                      <p className="rounded-xl border border-border bg-base px-4 py-3 text-sm text-muted">
                        Одоогоор нээлттэй лобби алга. PIN оруулах эсвэл өөрөө өрөө нээнэ үү.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {publicLobbies.map((lobby) => {
                          const categoryName =
                            categories.find((item) => item.slug === lobby.category)?.name ??
                            lobby.category
                          return (
                            <li key={lobby.id}>
                              <button
                                type="button"
                                disabled={multiBusy}
                                onClick={() => handleSelectLobby(lobby.pin)}
                                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-base px-4 py-3 text-left transition hover:border-cyan/40 hover:bg-raised disabled:opacity-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-bold text-ink">
                                    {categoryName} · {prettySlug(lobby.artistSlug)}
                                  </div>
                                  <div className="text-xs text-muted">
                                    {lobby.rounds} раунд · {lobby.timePerRound}с ·{' '}
                                    {lobby.playerCount} тоглогч
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
                  <NicknameInput
                    id="nickname"
                    label="Таны нэр"
                    value={nickname}
                    onChange={setNickname}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    className="min-w-[8rem] flex-1 py-3.5 text-sm sm:flex-none sm:px-7"
                    disabled={
                      multiBusy ||
                      !hasNickname ||
                      (!joinInvite && joinPin.length !== 6) ||
                      !acceptsPlayers
                    }
                    onClick={() => void handleJoinRoom(false)}
                  >
                    {multiBusy ? 'Нэгдэж байна…' : 'Тоглогчоор орох'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-w-[8rem] flex-1 py-3.5 text-sm sm:flex-none sm:px-7"
                    disabled={
                      multiBusy ||
                      !hasNickname ||
                      (!joinInvite && joinPin.length !== 6) ||
                      !acceptsSpectators
                    }
                    onClick={() => void handleJoinRoom(true)}
                  >
                    Үзэгчээр орох
                  </Button>
                </div>
                {joinInvite && (
                  <p className="mt-3 text-center text-xs text-muted">Хувийн урилгын холбоос илрүүлсэн.</p>
                )}
                {(joinLinkError || multiError) && (
                  <StatusMessage className="mt-4 text-center font-bold">
                    {joinLinkError ?? multiError}
                  </StatusMessage>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {(mode === 'solo' || multiSubMode === 'host') && (
        <>
      {/* Category grid */}
      <SectionLabel className="mb-4">Ангилал</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {loadingCategories ? (
          <div className="col-span-full flex items-center gap-3 text-muted">
            <EqualizerBars className="h-5" /> Ангиллуудыг ачааллаж байна…
          </div>
        ) : categoryError ? (
          <StatusMessage variant="error" className="col-span-full">
            {categoryError}
          </StatusMessage>
        ) : categories.length === 0 ? (
          <StatusMessage variant="warning" className="col-span-full">
            Идэвхтэй ангилал алга байна.
          </StatusMessage>
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
      <SectionLabel className="mb-4 mt-10">
        {selectedCategoryData?.pickerLabel ?? 'Багц'}
      </SectionLabel>
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
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {artists.map((a) => {
            const playable = a.songCount >= MIN_SONGS
            return (
              <SelectableCard
                key={a.id}
                selected={selectedArtist === a.slug}
                disabled={!playable}
                accent="#ec4899"
                onSelect={() => setSelectedArtist(a.slug)}
              >
                <span className="text-base font-bold text-ink" style={{ color: '#f2f4f8' }}>
                  {a.name}
                </span>
                <span className="text-xs text-muted">
                  {a.songCount} {selectedCategoryData?.itemLabel ?? 'асуулт'}
                  {playable ? '' : ` · дор хаяж ${MIN_SONGS} хэрэгтэй`}
                </span>
              </SelectableCard>
            )
          })}
        </div>
      )}

      {!isSupabaseConfigured && (
        <StatusMessage variant="warning" className="mt-6">
          ⚠ Supabase тохируулаагүй байна. <code>.env.example</code>-г <code>.env.local</code> болгож
          хуулаад төслийн URL, anon key-ээ оруулна уу.
        </StatusMessage>
      )}

      {/* Settings (Тохиргоо) */}
      <SectionLabel className="mb-4 mt-10">Тохиргоо</SectionLabel>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:gap-10">
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
        </>
      )}

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
      ) : multiSubMode === 'host' ? (
        <section className="mt-10 border-t border-border pt-8">
          <div className="mx-auto max-w-xl">
            <p className="mb-5 text-sm text-muted">Тохиргоогоо сонгоод найзуудаа урь.</p>
            <NicknameInput
              id="host-nickname"
              label="Хөтлөгчийн нэр"
              value={nickname}
              onChange={setNickname}
            />
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
              className="mt-5 w-full py-4 text-base"
              disabled={multiBusy || !hasNickname || !canStart}
              onClick={() => void handleCreateRoom()}
            >
              {multiBusy ? 'Өрөө нээж байна…' : 'ӨРӨӨ ҮҮСГЭХ →'}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
