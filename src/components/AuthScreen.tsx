import { useState } from 'react'
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
    'w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20'

  return (
    <div className="workspace-shell flex min-h-screen items-center justify-center px-5 py-6">
      <div className="w-full max-w-[400px] rounded-[34px] border border-black/8 bg-white p-6 shadow-[0_1px_0_rgba(17,17,22,0.03)] sm:p-8">
        <div className="text-center">
          <div className="deezer-display text-[2.4rem] leading-none text-[#111116]">sauti</div>
          <h2 className="mt-2 text-sm text-[#9c9da5]">
            {effectiveMode === 'signin' ? 'Sign in to continue' : 'Create an account'}
          </h2>
        </div>

        {!available && (
          <div className="mt-5 space-y-4 rounded-[28px] border border-black/8 bg-[#f8f8f9] p-5">
            <p className="text-sm text-[#686973]">
              The backend is unreachable right now. Please try again.
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
        )}

        {available && (
          <div className="mt-6 space-y-4">
            {errorMessage && (
              <div className="rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] px-4 py-3 text-sm text-[#983749]">
                {errorMessage}
              </div>
            )}

            {effectiveMode === 'signin' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSignIn()
                }}
                className="space-y-4"
              >
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
                      autoComplete="email"
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
                      autoComplete="current-password"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={submitting || !signinEmail.trim() || signinPassword.length < 8}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                >
                  <ArrowRight size={16} />
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleRegister()
                }}
                className="space-y-4"
              >
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
                      autoComplete="email"
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
                      autoComplete="new-password"
                    />
                  </div>
                </label>

                {requiresInviteCode && (
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
                )}

                <button
                  type="submit"
                  disabled={
                    submitting
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

                {!canRegister && (
                  <p className="text-sm text-[#7a7b86]">
                    Registration is closed — this shared backend already has its full set of accounts.
                  </p>
                )}
              </form>
            )}

            {canRegister && effectiveMode === 'signin' && (
              <p className="text-center text-sm text-[#7a7b86]">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Create one
                </button>
              </p>
            )}

            {effectiveMode === 'register' && (
              <p className="text-center text-sm text-[#7a7b86]">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}