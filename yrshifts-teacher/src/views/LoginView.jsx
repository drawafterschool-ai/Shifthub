import { useState, useEffect, useRef } from 'react'
import {
  signInWithEmailAndPassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from 'firebase/auth'
import { auth } from '../utils/firebase'

export default function LoginView() {
  const [mode,       setMode]       = useState('detecting')
  const [oobCode,    setOobCode]    = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [newPass,    setNewPass]    = useState('')
  const [newPass2,   setNewPass2]   = useState('')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Detect Firebase action URL (?mode=resetPassword&oobCode=XXX)
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search)
    const urlMode = params.get('mode')
    const code    = params.get('oobCode')

    // Handle email sign-in link (new invite flow)
    if (isSignInWithEmailLink(auth, window.location.href)) {
      setMode('signinlink')
      // Try to get email from localStorage (set when invite was sent)
      const savedEmail = window.localStorage.getItem('emailForSignIn')
      if (savedEmail) {
        setEmail(savedEmail)
        signInWithEmailLink(auth, savedEmail, window.location.href)
          .then(() => {
            window.localStorage.removeItem('emailForSignIn')
            window.history.replaceState({}, '', window.location.pathname)
            setMode('success')
          })
          .catch(err => {
            if (!mounted.current) return
            if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
              setMode('expired')
            } else {
              setMode('signinlink') // ask for email manually
            }
          })
      }
      // If no saved email, stay in signinlink mode and ask user to enter it
    } else if (urlMode === 'resetPassword' && code) {
      setOobCode(code)
      verifyPasswordResetCode(auth, code)
        .then(email => {
          if (!mounted.current) return
          setResetEmail(email)
          setMode('reset')
        })
        .catch(() => {
          if (!mounted.current) return
          setMode('expired')
          window.history.replaceState({}, '', window.location.pathname)
        })
    } else {
      setMode('login')
    }
  }, [])

  // Handle email sign-in link when user needs to enter their email manually
  const handleSignInLink = async (e) => {
    e.preventDefault()
    if (!mounted.current) return
    setError('')
    if (!email.trim()) { setError('Please enter your email address.'); return }
    setLoading(true)
    try {
      await signInWithEmailLink(auth, email.trim().toLowerCase(), window.location.href)
      window.localStorage.removeItem('emailForSignIn')
      window.history.replaceState({}, '', window.location.pathname)
      setMode('success')
    } catch (err) {
      if (!mounted.current) return
      setLoading(false)
      if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
        setMode('expired')
      } else if (err.code === 'auth/invalid-email') {
        setError('Please check your email address.')
      } else {
        setError('Sign-in failed. Please request a new invite.')
      }
    }
  }

  // Set new password then rely on auth state to transition into the app
  const handleResetSubmit = async (e) => {
    e.preventDefault()
    if (!mounted.current) return
    setError('')
    if (newPass.length < 6)  { setError('Password must be at least 6 characters.'); return }
    if (newPass !== newPass2) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      // 1. Set the password
      await confirmPasswordReset(auth, oobCode, newPass)

      // 2. Show spinner
      if (mounted.current) setMode('success')

      // 3. Sign in
      await signInWithEmailAndPassword(auth, resetEmail, newPass)

      // 4. Remove reset query params and let auth listener render the app
      window.history.replaceState({}, '', window.location.pathname)
    } catch (err) {
      console.error('Reset error:', err.code, err.message)
      if (!mounted.current) return
      setLoading(false)
      if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
        setMode('expired')
      } else if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password'
      ) {
        // Password was saved — sign-in failed for another reason, let them log in manually
        setEmail(resetEmail)
        setMode('login')
        setError('Password saved! Please sign in below.')
      } else {
        setEmail(resetEmail)
        setMode('login')
        setError('Something went wrong. Please sign in below.')
      }
    }
  }

  // Normal login — let auth state switch the app view
  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    if (!mounted.current) return
    setError('')
    setLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      await signInWithEmailAndPassword(auth, normalizedEmail, password)
    } catch (err) {
      console.error('Login error:', err.code)
      if (!mounted.current) return
      setLoading(false)
      const known = [
        'auth/user-not-found', 'auth/wrong-password',
        'auth/invalid-credential', 'auth/invalid-email',
      ]
      setError(known.includes(err.code) ? 'Incorrect email or password.' : 'Sign in failed — please try again.')
    }
  }

  const INPUT = "w-full bg-raised border border-app rounded-xl px-4 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

  // Loading / success spinner
  if (mode === 'detecting' || mode === 'success') return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-app gap-4">
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-3xl">📅</div>
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      <p className="text-sm text-muted">{mode === 'success' ? 'Signing you in…' : 'Loading…'}</p>
    </div>
  )

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-app p-6">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-3xl mb-4">📅</div>
          <h1 className="text-2xl font-bold text-primary">ShiftHub</h1>
          <p className="text-sm text-muted mt-1">
            {mode === 'reset'   ? 'Create your password to get started' :
             mode === 'expired' ? 'Link expired' :
             'Sign in to your account'}
          </p>
        </div>

        <div className="bg-surface border border-app rounded-2xl p-6">

          {/* Email sign-in link — ask for email if not auto-detected */}
          {mode === 'signinlink' && (
            <form onSubmit={handleSignInLink} className="flex flex-col gap-4">
              <div className="bg-accent-soft border border-accent/20 rounded-xl px-3 py-2.5">
                <p className="text-xs text-accent font-semibold">Welcome to ShiftHub!</p>
                <p className="text-xs text-muted mt-0.5">Enter your email address to complete sign-in.</p>
              </div>
              {error && (
                <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-3 py-2.5 text-sm">
                  ⚠️ {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Your email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required placeholder="you@example.com" className={INPUT} autoFocus />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm cursor-pointer border-none">
                {loading ? 'Signing in…' : '✓ Complete sign-in'}
              </button>
            </form>
          )}

          {/* Expired */}
          {mode === 'expired' && (
            <div className="text-center py-4">
              <p className="text-3xl mb-3">⏱</p>
              <p className="text-sm font-semibold text-primary mb-2">This link has expired</p>
              <p className="text-sm text-muted leading-relaxed mb-5">
                Invite links expire after 6 hours. Ask your administrator to send a new one.
              </p>
              <button onClick={() => { setMode('login'); setError('') }}
                className="text-sm text-accent font-semibold cursor-pointer bg-transparent border-none">
                ← Sign in instead
              </button>
            </div>
          )}

          {/* Set password */}
          {mode === 'reset' && (
            <form onSubmit={handleResetSubmit} className="flex flex-col gap-4">
              <div className="bg-accent-soft border border-accent/20 rounded-xl px-3 py-2.5 -mb-1">
                <p className="text-xs text-accent font-semibold">Welcome! Creating account for:</p>
                <p className="text-sm text-primary font-bold truncate">{resetEmail}</p>
              </div>
              {error && (
                <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-3 py-2.5 text-sm">
                  ⚠️ {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Choose a password
                </label>
                <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                  required minLength={6} placeholder="At least 6 characters" className={INPUT} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Confirm password
                </label>
                <input type="password" value={newPass2} onChange={e => setNewPass2(e.target.value)}
                  required placeholder="Repeat your password" className={INPUT} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm cursor-pointer border-none mt-1">
                {loading ? 'Setting password…' : '✓ Set password & sign in'}
              </button>
              <button type="button" onClick={() => { setMode('login'); setEmail(resetEmail); setError('') }}
                className="text-xs text-dim text-center cursor-pointer bg-transparent border-none hover:text-muted">
                Already have a password? Sign in instead
              </button>
            </form>
          )}

          {/* Normal login */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
              {error && (
                <div className={`border rounded-xl px-3 py-2.5 text-sm ${
                  error.includes('saved') ? 'bg-ok-soft border-ok/30 text-ok' : 'bg-danger-soft border-danger/30 text-danger'
                }`}>
                  {error.includes('saved') ? '✅' : '⚠️'} {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required placeholder="you@example.com" className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required placeholder="••••••••" className={INPUT} autoFocus={!!email} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm cursor-pointer border-none mt-1">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-2xs text-dim mt-6">Young Rembrandts · ShiftHub</p>
      </div>
    </div>
  )
}
