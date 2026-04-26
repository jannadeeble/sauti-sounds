import { type ReactNode, useState } from 'react'
import { ArrowRight, LockKeyhole, Mail, RefreshCcw, UserRound } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

type AuthMode = 'signin' | 'register'

export default function AuthScreen() {
  const {
    available,
    submitting,
    canRegister,
    requiresInviteCode,
    initialize,
    login,
    register,
  } = useAuthStore()

  const [mode, setMode] = useState<AuthMode>('signin')
  const [signinEmail, setSigninEmail] = useState('')
  const [signinPassword, setSigninPassword] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const effectiveMode: AuthMode = !canRegister && mode === 'register' ? 'signin' : mode

  async function handleSignIn() {
    setErrorMessage(null)
    try {
      await login({
        email: signinEmail,
        password: signinPassword,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not sign in')
    }
  }

  async function handleRegister() {
    setErrorMessage(null)
    try {
      await register({
        name: registerName,
        email: registerEmail,
        password: registerPassword,
        inviteCode: inviteCode || undefined,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create account')
    }
  }

  const inputClass =
    'w-full rounded-[18px] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white outline-none placeholder:text-white/26 focus:border-white/20'

  return (
    <div className="sauti-theme flex min-h-screen items-center justify-center px-5 py-10">
      <div className="absolute inset-0 sauti-stage" aria-hidden />
      <section className="relative flex w-full max-w-[420px] items-center justify-center">
        <div className="w-full rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(24,27,38,0.86),rgba(14,16,24,0.82))] p-6 backdrop-blur-2xl">
          <div className="text-center">
            <div className="sauti-title text-[2.7rem] leading-none text-white">sauti</div>
            <p className="mt-2 text-sm text-white/44">
              {effectiveMode === 'signin' ? 'Sign in to continue' : 'Create an account'}
            </p>
          </div>

          {!available ? (
            <div className="mt-6 space-y-4 rounded-[24px] border border-white/10 bg-white/4 p-5">
              <p className="text-sm text-white/58">
                The backend is unreachable right now. Try refreshing the session when the service is back.
              </p>
              <button
                type="button"
                onClick={() => void initialize()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-white/82 transition-colors hover:bg-white/9"
              >
                <RefreshCcw size={15} />
                Try again
              </button>
            </div>
          ) : null}

          {available ? (
            <div className="mt-6 space-y-4">
              <div className="flex rounded-full border border-white/10 bg-white/4 p-1">
                <ModeButton
                  active={effectiveMode === 'signin'}
                  onClick={() => setMode('signin')}
                  label="Sign in"
                />
                <ModeButton
                  active={effectiveMode === 'register'}
                  onClick={() => setMode('register')}
                  label="Create account"
                  disabled={!canRegister}
                />
              </div>

              {errorMessage ? (
                <div className="rounded-[18px] border border-[#6d2b22] bg-[#311612] px-4 py-3 text-sm text-[#ffb4a6]">
                  {errorMessage}
                </div>
              ) : null}

              {effectiveMode === 'signin' ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleSignIn()
                  }}
                  className="space-y-4"
                >
                  <Field label="Email" icon={<Mail size={16} />}>
                    <input
                      type="email"
                      value={signinEmail}
                      onChange={(event) => setSigninEmail(event.target.value)}
                      placeholder="you@example.com"
                      className={`${inputClass} pl-11`}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label="Password" icon={<LockKeyhole size={16} />}>
                    <input
                      type="password"
                      value={signinPassword}
                      onChange={(event) => setSigninPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className={`${inputClass} pl-11`}
                      autoComplete="current-password"
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={submitting || !signinEmail.trim() || signinPassword.length < 8}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[18px] bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                  >
                    <ArrowRight size={16} />
                    {submitting ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleRegister()
                  }}
                  className="space-y-4"
                >
                  <Field label="Display name" icon={<UserRound size={16} />}>
                    <input
                      type="text"
                      value={registerName}
                      onChange={(event) => setRegisterName(event.target.value)}
                      placeholder="Your name"
                      className={`${inputClass} pl-11`}
                    />
                  </Field>

                  <Field label="Email" icon={<Mail size={16} />}>
                    <input
                      type="email"
                      value={registerEmail}
                      onChange={(event) => setRegisterEmail(event.target.value)}
                      placeholder="you@example.com"
                      className={`${inputClass} pl-11`}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label="Password" icon={<LockKeyhole size={16} />}>
                    <input
                      type="password"
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className={`${inputClass} pl-11`}
                      autoComplete="new-password"
                    />
                  </Field>

                  {requiresInviteCode ? (
                    <div className="space-y-2">
                      <span className="text-[11px] uppercase tracking-[0.24em] text-white/34">Invite code</span>
                      <input
                        type="password"
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        placeholder="Shared invite code"
                        className={inputClass}
                      />
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={
                      submitting
                      || !canRegister
                      || !registerEmail.trim()
                      || registerPassword.length < 8
                      || (requiresInviteCode && !inviteCode.trim())
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[18px] bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                  >
                    <ArrowRight size={16} />
                    {submitting ? 'Creating account…' : 'Create account'}
                  </button>

                  {!canRegister ? (
                    <p className="text-sm text-white/44">Registration is currently closed for this workspace.</p>
                  ) : null}
                </form>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.24em] text-white/34">{label}</span>
      <div className="relative">
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/34">{icon}</div>
        {children}
      </div>
    </label>
  )
}

function ModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
        active ? 'bg-white/12 text-white' : 'text-white/54 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}
