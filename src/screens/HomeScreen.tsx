import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { CategoryCard } from '../components/CategoryCard'
import { EqualizerBars } from '../components/EqualizerBars'
import { fetchArtists } from '../api/songs'
import { isSupabaseConfigured } from '../lib/supabase'
import type { ArtistOption, GameConfig } from '../types'

interface Props {
  onStart: (slug: string, config: GameConfig) => void
  onOpenLeaderboard: () => void
}

const MIN_SONGS = 4 // need at least 4 songs to fill the answer options
const MAX_POINTS = 1000

const ROUND_OPTIONS = [3, 5, 10]
const TIME_OPTIONS = [10, 15, 20, 30]

const CATEGORIES = [
  { key: 'song', icon: '🎵', title: 'Дуу', subtitle: 'Дууг сонсоод таа', accent: '#ec4899', active: true },
  { key: 'cartoon', icon: '📺', title: 'Хүүхэлдэйн кино', subtitle: 'Дуугаар нь таа', accent: '#22d3ee', active: false },
  { key: 'movie', icon: '🎬', title: 'Кино', subtitle: 'Хэсгээр нь таа', accent: '#a855f7', active: false },
  { key: 'tv', icon: '🎭', title: 'ТВ шоу', subtitle: 'Хараад таа', accent: '#f59e0b', active: false },
  { key: 'actor', icon: '⭐', title: 'Жүжигчин', subtitle: 'Нэрийг нь таа', accent: '#6366f1', active: false },
  { key: 'web', icon: '💻', title: 'Веб цуврал', subtitle: 'Таньж таа', accent: '#34d399', active: false },
]

export function HomeScreen({ onStart, onOpenLeaderboard }: Props) {
  const [selectedCategory, setSelectedCategory] = useState('song')
  const [mode, setMode] = useState<'solo' | 'multi'>('solo')

  const [artists, setArtists] = useState<ArtistOption[]>([])
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
  const [loadingArtists, setLoadingArtists] = useState(true)
  const [artistError, setArtistError] = useState<string | null>(null)

  const [rounds, setRounds] = useState(5)
  const [timePerRound, setTimePerRound] = useState(15)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoadingArtists(false)
      return
    }
    let cancelled = false
    fetchArtists()
      .then((list) => {
        if (cancelled) return
        setArtists(list)
        // Default to the first artist that has enough songs to play.
        const firstPlayable = list.find((a) => a.songCount >= MIN_SONGS)
        setSelectedArtist(firstPlayable?.slug ?? null)
      })
      .catch((err) => !cancelled && setArtistError(err.message))
      .finally(() => !cancelled && setLoadingArtists(false))
    return () => {
      cancelled = true
    }
  }, [])

  const selected = artists.find((a) => a.slug === selectedArtist)
  const canStart = Boolean(selected && selected.songCount >= MIN_SONGS)

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      {/* Top bar */}
      <div className="mb-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <EqualizerBars className="h-6" />
          <span className="text-xl font-extrabold tracking-tight">Таа</span>
        </div>
        <span className="text-sm text-muted">Guess everything · MN</span>
      </div>

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
          disabled
          className="cursor-not-allowed rounded-lg px-5 py-2 text-sm font-bold text-muted-2"
          title="Тун удахгүй"
        >
          Хамтдаа · удахгүй
        </button>
      </div>

      {/* Category grid */}
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-2">Ангилал</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <CategoryCard
            key={c.key}
            icon={c.icon}
            title={c.title}
            subtitle={c.subtitle}
            accent={c.accent}
            active={c.active}
            selected={selectedCategory === c.key}
            onSelect={() => setSelectedCategory(c.key)}
          />
        ))}
        <CategoryCard
          icon="🏆"
          title="Тэргүүлэгчид"
          subtitle="Онооны самбар"
          accent="#f59e0b"
          active
          onSelect={onOpenLeaderboard}
        />
      </div>

      {/* Artist picker */}
      <div className="mb-4 mt-10 text-xs font-bold uppercase tracking-widest text-muted-2">
        Уран бүтээлч
      </div>
      {loadingArtists ? (
        <div className="flex items-center gap-3 text-muted">
          <EqualizerBars className="h-5" /> Уран бүтээлчдийг ачааллаж байна…
        </div>
      ) : artistError ? (
        <p className="rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {artistError}
        </p>
      ) : artists.length === 0 ? (
        <p className="rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          Уран бүтээлч алга байна. <code>npm run ingest</code> ажиллуулж дуу нэмнэ үү.
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
                <span className="text-base font-bold text-ink">{a.name}</span>
                <span className="text-xs text-muted">
                  {a.songCount} дуу{playable ? '' : ` · дор хаяж ${MIN_SONGS} хэрэгтэй`}
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

      {/* Start */}
      <div className="mt-10">
        <Button
          onClick={() =>
            selectedArtist &&
            onStart(selectedArtist, { rounds, timePerRound, maxPoints: MAX_POINTS })
          }
          disabled={!canStart}
          className="w-full py-4 text-base sm:w-auto sm:px-12"
        >
          ▶ {selected ? `${selected.name}-тэй тоглох` : 'Тоглоом эхлүүлэх'}
        </Button>
      </div>
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
