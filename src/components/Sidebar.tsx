import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { EqualizerBars } from './EqualizerBars'
import { resolveDisplayName } from '../api/auth'

export type NavView = 'home' | 'create' | 'join' | 'leaderboard' | 'account'

interface Props {
  active: NavView
  onNavigate: (view: NavView) => void
}

const ICONS: Record<Exclude<NavView, 'account'>, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>
  ),
  create: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  join: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </>
  ),
  leaderboard: (
    <>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </>
  ),
}

const NAV: { key: Exclude<NavView, 'account'>; label: string }[] = [
  { key: 'home', label: 'Нүүр' },
  { key: 'create', label: 'Өрөө нээх' },
  { key: 'join', label: 'Өрөөнд орох' },
  { key: 'leaderboard', label: 'Тэргүүлэгчид' },
]

function NavIcon({ view }: { view: Exclude<NavView, 'account'> }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      {ICONS[view]}
    </svg>
  )
}

/** Left navigation rail (desktop) + bottom tab bar (mobile). One source of nav truth. */
export function Sidebar({ active, onNavigate }: Props) {
  const [name, setName] = useState('')

  useEffect(() => {
    let cancelled = false
    void resolveDisplayName().then((resolved) => {
      if (!cancelled && resolved) setName(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const displayName = name.trim() || 'Нэргүй'
  const initial = displayName.charAt(0).toUpperCase()

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 z-20 hidden h-screen w-60 flex-none flex-col border-r border-border bg-surface/50 py-6 backdrop-blur lg:flex">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-3 px-6 pb-6 text-left"
          aria-label="Нүүр"
        >
          <EqualizerBars className="h-7" />
          <div>
            <div className="text-[22px] font-black leading-none tracking-tight text-ink">Таа</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-2">Таах тоглоом</div>
          </div>
        </button>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => {
            const isActive = active === item.key
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
                }`}
              >
                <NavIcon view={item.key} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <button
          onClick={() => onNavigate('account')}
          className={`mx-4 mt-3 flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
            active === 'account' ? 'border-pink/50 bg-raised' : 'border-border bg-surface hover:bg-raised'
          }`}
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-pink to-purple text-[17px] font-black text-white">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{displayName}</span>
            <span className="block text-[11px] text-muted">Профайл →</span>
          </span>
        </button>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map((item) => {
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition ${
                isActive ? 'text-ink' : 'text-muted'
              }`}
            >
              <NavIcon view={item.key} />
              {item.label}
            </button>
          )
        })}
        <button
          onClick={() => onNavigate('account')}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition ${
            active === 'account' ? 'text-ink' : 'text-muted'
          }`}
        >
          <span className="grid h-[18px] w-[18px] place-items-center rounded-md bg-gradient-to-br from-pink to-purple text-[10px] font-black text-white">
            {initial}
          </span>
          Профайл
        </button>
      </nav>
    </>
  )
}
