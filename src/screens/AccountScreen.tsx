import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { NicknameInput } from '../components/NicknameInput'
import { PillToggle } from '../components/PillToggle'
import { SectionLabel } from '../components/SectionLabel'
import { StatusMessage } from '../components/StatusMessage'
import {
  getAuthEmail,
  resetPasswordForEmail,
  resolveDisplayName,
  sendMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updateDisplayName,
} from '../api/auth'

export function AccountScreen() {
  const [nickname, setNickname] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)

  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [signOutBusy, setSignOutBusy] = useState(false)

  const [authMethod, setAuthMethod] = useState<'magic' | 'password'>('magic')
  const [magicEmail, setMagicEmail] = useState('')
  const [magicBusy, setMagicBusy] = useState(false)
  const [magicMessage, setMagicMessage] = useState<string | null>(null)

  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  const hasNickname = nickname.trim().length >= 2

  async function loadState() {
    const [name, currentEmail] = await Promise.all([resolveDisplayName(), getAuthEmail()])
    setNickname(name)
    setAuthEmail(currentEmail)
  }

  useEffect(() => {
    void loadState()
  }, [])

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

  async function handlePasswordAuth() {
    if (authBusy) return
    setAuthBusy(true)
    setAuthMessage(null)
    try {
      if (authMode === 'signup') {
        const { needsConfirmation } = await signUpWithPassword(email, password)
        if (needsConfirmation) {
          setAuthMessage('И-мэйл хаяг руугаа баталгаажуулах холбоос илгээлээ.')
        } else {
          await loadState()
        }
      } else {
        await signInWithPassword(email, password)
        await loadState()
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Нэвтэрч чадсангүй')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleResetPassword() {
    if (resetBusy || !email.includes('@')) return
    setResetBusy(true)
    setResetMessage(null)
    try {
      await resetPasswordForEmail(email)
      setResetMessage('Сэргээх холбоос илгээлээ.')
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : 'Холбоос илгээж чадсангүй')
    } finally {
      setResetBusy(false)
    }
  }

  async function handleSignOut() {
    if (signOutBusy) return
    setSignOutBusy(true)
    try {
      await signOut()
      await loadState()
    } finally {
      setSignOutBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-10">
      <h1 className="mb-8 text-3xl font-extrabold">Профайл</h1>

      <section className="mb-8 max-w-md">
        <SectionLabel className="mb-2">Нэр</SectionLabel>
        <NicknameInput
          id="account-nickname"
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
      </section>

      <SectionLabel className="mb-2">Нэвтрэлт</SectionLabel>
      {authEmail ? (
        <div className="max-w-md rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">
            Нэвтэрсэн: <span className="font-bold text-ink">{authEmail}</span>
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            disabled={signOutBusy}
            onClick={() => void handleSignOut()}
          >
            {signOutBusy ? '…' : 'Гарах'}
          </Button>
        </div>
      ) : (
        <div className="max-w-md rounded-2xl border border-border bg-surface p-5">
          <PillToggle
            className="mb-4"
            value={authMethod}
            onChange={(value) => {
              setAuthMethod(value)
              setAuthMessage(null)
              setMagicMessage(null)
            }}
            options={[
              { value: 'magic', label: 'Холбоос' },
              { value: 'password', label: 'Нууц үг' },
            ]}
          />

          {authMethod === 'magic' ? (
            <div>
              <label className="block text-sm font-bold text-muted" htmlFor="magic-email">
                И-мэйлээр нэвтрэх
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
                    className="w-full rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none focus:border-cyan/60"
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
            </div>
          ) : (
            <div>
              <PillToggle
                className="mb-3"
                value={authMode}
                onChange={(value) => {
                  setAuthMode(value)
                  setAuthMessage(null)
                }}
                background="surface"
                options={[
                  { value: 'signup', label: 'Бүртгүүлэх' },
                  { value: 'signin', label: 'Нэвтрэх' },
                ]}
              />
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setAuthMessage(null)
                  }}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none focus:border-cyan/60"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setAuthMessage(null)
                  }}
                  placeholder="Нууц үг"
                  className="w-full rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none focus:border-cyan/60"
                />
              </div>
              <Button
                className="mt-3 w-full py-3 text-sm"
                disabled={authBusy || !email.includes('@') || password.length < 6}
                onClick={() => void handlePasswordAuth()}
              >
                {authBusy ? '…' : authMode === 'signup' ? 'Бүртгүүлэх' : 'Нэвтрэх'}
              </Button>
              {authMessage && (
                <StatusMessage
                  variant={authMessage.includes('баталгаажуулах') ? 'warning' : 'error'}
                  className="mt-3"
                >
                  {authMessage}
                </StatusMessage>
              )}
              <button
                type="button"
                onClick={() => void handleResetPassword()}
                disabled={resetBusy || !email.includes('@')}
                className="mt-3 text-xs text-muted underline decoration-dotted hover:text-ink disabled:opacity-40"
              >
                Нууц үгээ мартсан уу?
              </button>
              {resetMessage && (
                <p className="mt-2 text-xs text-muted">{resetMessage}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
