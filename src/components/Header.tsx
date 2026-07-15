import { EqualizerBars } from './EqualizerBars'

export type NavView = 'home' | 'leaderboard'

interface Props {
  active: NavView
  onNavigate: (view: NavView) => void
}

const LINKS: { key: NavView; label: string }[] = [
  { key: 'home', label: 'Нүүр' },
  { key: 'leaderboard', label: 'Тэргүүлэгчид' },
]

/** Top navigation bar shown on the Home and Leaderboard pages. */
export function Header({ active, onNavigate }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-base/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-3"
          aria-label="Нүүр"
        >
          <EqualizerBars className="h-6" />
          <span className="text-xl font-extrabold tracking-tight">Таа</span>
        </button>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const isActive = active === link.key
            return (
              <button
                key={link.key}
                onClick={() => onNavigate(link.key)}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                  isActive ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {link.label}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
