import { Button } from './Button'

interface Action {
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}

interface Message {
  text: string
  tone: 'success' | 'error'
}

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  background?: 'base' | 'surface'
  action?: Action
  message?: Message | null
  className?: string
}

/** Shared nickname field — used for the profile card, join panel, and host panel. */
export function NicknameInput({
  id,
  label,
  value,
  onChange,
  background = 'base',
  action,
  message,
  className = '',
}: Props) {
  return (
    <div className={className}>
      <label className="block text-sm font-bold text-muted" htmlFor={id}>
        {label}
        <div className="mt-2 flex gap-2">
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={24}
            placeholder="Таны нэр"
            className={`w-full rounded-xl border border-border px-4 py-3 text-ink outline-none focus:border-cyan/60 ${
              background === 'surface' ? 'bg-surface' : 'bg-base'
            }`}
          />
          {action && (
            <Button
              variant="ghost"
              className="shrink-0 px-4 py-3 text-sm"
              disabled={action.disabled || action.busy}
              onClick={action.onClick}
            >
              {action.busy ? '…' : action.label}
            </Button>
          )}
        </div>
      </label>
      {message && (
        <p className={`mt-2 text-sm ${message.tone === 'success' ? 'text-cyan' : 'text-pink'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
