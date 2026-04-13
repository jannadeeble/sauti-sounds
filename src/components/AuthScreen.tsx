import { useEffect, useState } from 'react'
import { ArrowRight, LockKeyhole, Mail, RefreshCcw, UserRound } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

type AuthMode = 'signin' | 'register'

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="deezer-brand-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="deezer-display text-[2rem] leading-none text-[#111116]">sauti</div>
    </div>
  )
}

export default function AuthScreen() {
  const {
    available,
    loading,
    submitting,
    canRegister,
    userCount,
    maxUsers,
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

  useEffect(() => {
    if (canRegister && userCount === 0) {
      setMode('register')
      return
    }

    if (!canRegister && mode === 'register') {
      setMode('signin')
    }
  }, [canRegister, mode, userCount])

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
    'w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20'

  return (
    <div className="workspace-shell min-h-screen px-5 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.15fr)_420px] lg:items-center">
          <section className="rounded-[34px] border border-black/8 bg-white p-7 shadow-[0_1px_0_rgba(17,17,22,0.03)] sm:p-10">
            <BrandMark />
            <div className="mt-10 max-w-xl space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#9c9da5]">Shared listening</p>
              <h1 className="deezer-display text-[3.3rem] leading-[0.9] text-[#111116] sm:text-[4.3rem]">
                Sign in to your shared Sauti space.
              </h1>
              <p className="max-w-lg text-base leading-7 text-[#686973]">
                Each person gets their own account, while the library, playlists, and TIDAL connection stay on the same private backend.
              </p>
              <div className="grid gap-3 text-sm text-[#686973] sm:grid-cols-3">
                <div className="rounded-[24px] border border-black/6 bg-[#f8f8f9] px-4 py-4">
                  <p className="deezer-display text-[2rem] text-[#111116]">{maxUsers}</p>
                  <p className="mt-1">shared seats</p>
                </div>
                <div className="rounded-[24px] border border-black/6 bg-[#f8f8f9] px-4 py-4">
                  <p className="deezer-display text-[2rem] text-[#111116]">{userCount}</p>
                  <p className="mt-1">accounts created</p>
                </div>
                <div className="rounded-[24px] border border-black/6 bg-[#f8f8f9] px-4 py-4">
                  <p className="deezer-display text-[2rem] text-[#111116]">{requiresInviteCode ? 'Code' : 'Open'}</p>
                  <p className="mt-1">{requiresInviteCode ? 'invite required' : 'registration enabled'}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-black/8 bg-white p-6 shadow-[0_1px_0_rgba(17,17,22,0.03)] sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#9c9da5]">Access</p>
                <h2 className="deezer-display mt-2 text-[2.3rem] leading-none text-[#111116]">
                  {loading ? 'Checking session' : mode === 'signin' ? 'Welcome back' : 'Create account'}
                </h2>
              </div>
              {!loading ? (
                <div className="rounded-full border border-black/8 bg-[#f8f8f9] p-1">
                  <button
                    type="button"
                    onClick={() => setMode('signin')}
                    className={`rounded-full px-4 py-2 text-sm transition-colors ${
                      mode === 'signin' ? 'bg-white text-[#111116] shadow-sm' : 'text-[#7a7b86]'
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    disabled={!canRegister}
                    className={`rounded-full px-4 py-2 text-sm transition-colors ${
                      mode === 'register' ? 'bg-white text-[#111116] shadow-sm' : 'text-[#7a7b86]'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    Create account
                  </button>
                </div>
              ) : null}
            </div>

            {errorMessage ? (
              <div className="mt-5 rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] px-4 py-3 text-sm text-[#983749]">
                {errorMessage}
              </div>
            ) : null}

            {!available ? (
              <div className="mt-5 space-y-4 rounded-[28px] border border-black/8 bg-[#f8f8f9] p-5">
                <p className="text-sm text-[#686973]">
                  The backend is unreachable right now, so authentication cannot start.
                </p>
                <button
                  type="button"
                  onClick={() => void initialize()}
                  className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-sm text-[#111116] transition-colors hover:bg-[#f1f1f4]"
                >
                  <RefreshCcw size={15} />
                  Try again
                </button>
              </div>
            ) : null}

            {available ? (
              <div className="mt-6 space-y-4">
                {mode === 'signin' ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Email</span>
                      <div className="relative">
                        <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9ea0aa]" />
                        <input
                          type="email"
                          value={signinEmail}
                          onChange={(event) => setSigninEmail(event.target.value)}
                          placeholder="you@example.com"
                          className={`${inputClass} pl-11`}
                        />
                      </div>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Password</span>
                      <div className="relative">
                        <LockKeyhole size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9ea0aa]" />
                        <input
                          type="password"
                          value={signinPassword}
                          onChange={(event) => setSigninPassword(event.target.value)}
                          placeholder="At least 8 characters"
                          className={`${inputClass} pl-11`}
                        />
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleSignIn()}
                      disabled={loading || submitting || !signinEmail.trim() || signinPassword.length < 8}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                    >
                      <ArrowRight size={16} />
                      {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                  </>
                ) : (
                  <>
                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Display name</span>
                      <div className="relative">
                        <UserRound size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9ea0aa]" />
                        <input
                          type="text"
                          value={registerName}
                          onChange={(event) => setRegisterName(event.target.value)}
                          placeholder="Your name"
                          className={`${inputClass} pl-11`}
                        />
                      </div>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Email</span>
                      <div className="relative">
                        <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9ea0aa]" />
                        <input
                          type="email"
                          value={registerEmail}
                          onChange={(event) => setRegisterEmail(event.target.value)}
                          placeholder="you@example.com"
                          className={`${inputClass} pl-11`}
                        />
                      </div>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Password</span>
                      <div className="relative">
                        <LockKeyhole size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9ea0aa]" />
                        <input
                          type="password"
                          value={registerPassword}
                          onChange={(event) => setRegisterPassword(event.target.value)}
                          placeholder="At least 8 characters"
                          className={`${inputClass} pl-11`}
                        />
                      </div>
                    </label>

                    {requiresInviteCode ? (
                      <label className="block space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9c9da5]">Invite code</span>
                        <input
                          type="password"
                          value={inviteCode}
                          onChange={(event) => setInviteCode(event.target.value)}
                          placeholder="Shared invite code"
                          className={inputClass}
                        />
                      </label>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void handleRegister()}
                      disabled={
                        loading
                        || submitting
                        || !canRegister
                        || !registerEmail.trim()
                        || registerPassword.length < 8
                        || (requiresInviteCode && !inviteCode.trim())
                      }
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                    >
                      <ArrowRight size={16} />
                      {submitting ? 'Creating account…' : 'Create account'}
                    </button>

                    {!canRegister ? (
                      <p className="text-sm text-[#7a7b86]">
                        Registration is closed because this shared backend already has its full set of accounts.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
