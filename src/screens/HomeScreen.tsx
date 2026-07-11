import { useState } from 'react'
import { Button } from '../components/Button'
import { CategoryCard } from '../components/CategoryCard'
import { EqualizerBars } from '../components/EqualizerBars'
import { isSupabaseConfigured } from '../lib/supabase'

interface Props {
  onStart: () => void
}

const CATEGORIES = [
  { key: 'song', icon: '🎵', title: 'Дуу', subtitle: 'Дууг сонсоод таа', accent: '#ec4899', active: true },
  { key: 'cartoon', icon: '📺', title: 'Хүүхэлдэйн кино', subtitle: 'Дуугаар нь таа', accent: '#22d3ee', active: false },
  { key: 'movie', icon: '🎬', title: 'Кино', subtitle: 'Хэсгээр нь таа', accent: '#a855f7', active: false },
  { key: 'tv', icon: '🎭', title: 'ТВ шоу', subtitle: 'Хараад таа', accent: '#f59e0b', active: false },
  { key: 'actor', icon: '⭐', title: 'Жүжигчин', subtitle: 'Нэрийг нь таа', accent: '#6366f1', active: false },
  { key: 'web', icon: '💻', title: 'Веб цуврал', subtitle: 'Таньж таа', accent: '#34d399', active: false },
]

export function HomeScreen({ onStart }: Props) {
  const [selected, setSelected] = useState('song')
  const [mode, setMode] = useState<'solo' | 'multi'>('solo')

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
          Монгол дуу, кино, жүжигчдийг таних тоглоом. Хурдан таавал өндөр оноо. Өнөөдөр:{' '}
          <span className="font-semibold text-cyan">Вандебо</span>-гийн дуунууд.
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
            selected={selected === c.key}
            onSelect={() => setSelected(c.key)}
          />
        ))}
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          ⚠ Supabase тохируулаагүй байна. <code>.env.example</code>-г <code>.env.local</code> болгож
          хуулаад төслийн URL, anon key-ээ оруулна уу.
        </p>
      )}

      {/* Start */}
      <div className="mt-10">
        <Button onClick={onStart} className="w-full py-4 text-base sm:w-auto sm:px-12">
          ▶ Тоглоом эхлүүлэх
        </Button>
      </div>
    </div>
  )
}
