import { useState, useEffect, useRef } from 'react'
import {
  signInWithEmailAndPassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../utils/firebase'
import { isBiometricsSupported, authenticateBiometrics, isBiometricsEnabled } from '../utils/biometric'

export default function LoginView() {
  const [mode,       setMode]       = useState('detecting')
  const [oobCode,    setOobCode]    = useState('')
  const [customToken, setCustomToken] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [newPass,    setNewPass]    = useState('')
  const [newPass2,   setNewPass2]   = useState('')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  
  // Resend invite link flow state
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError,   setResendError]   = useState('')

  const [bioSupported, setBioSupported] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)
  const [staySignedIn, setStaySignedIn] = useState(true)

  const handleBiometricLogin = async () => {
    if (!mounted.current) return
    setError('')
    setLoading(true)
    try {
      const creds = await authenticateBiometrics()
      await signInWithEmailAndPassword(auth, creds.email, creds.password)
    } catch (err) {
      console.warn('Biometric login failed:', err)
      if (mounted.current) {
        setError(err.message || 'Biometric authentication failed')
      }
    } finally {
      if (mounted.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    async function checkBio() {
      const supported = await isBiometricsSupported()
      if (mounted.current) setBioSupported(supported)
      const enabled = isBiometricsEnabled()
      if (mounted.current) setBioEnabled(enabled)
      
      if (supported && enabled) {
        setTimeout(() => {
          if (mounted.current) {
            handleBiometricLogin()
          }
        }, 600)
      }
    }
    checkBio()
  }, [])

  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Detect Firebase action URL (?mode=resetPassword&oobCode=XXX&email=...) or custom token (?mode=resetPassword&token=XXX&email=...)
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search)
    const urlMode = params.get('mode')
    const code    = params.get('oobCode')
    const token   = params.get('token')
    const emailParam = params.get('email') || ''

    if (urlMode === 'resetPassword') {
      if (code) {
        setOobCode(code)
        verifyPasswordResetCode(auth, code)
          .then(email => {
            if (!mounted.current) return
            setResetEmail(email)
            setEmail(email)
            setMode('reset')
          })
          .catch(() => {
            if (!mounted.current) return
            if (emailParam) {
              setResetEmail(emailParam)
              setEmail(emailParam)
            }
            setMode('expired')
            window.history.replaceState({}, '', window.location.pathname)
          })
      } else if (token) {
        setCustomToken(token)
        const verifyFn = httpsCallable(functions, 'verifyResetToken')
        verifyFn({ token })
          .then(res => {
            if (!mounted.current) return
            if (res.data?.valid) {
              setResetEmail(res.data.email)
              setEmail(res.data.email)
              setMode('reset')
            } else {
              if (emailParam) {
                setResetEmail(emailParam)
                setEmail(emailParam)
              }
              setMode('expired')
              window.history.replaceState({}, '', window.location.pathname)
            }
          })
          .catch(() => {
            if (!mounted.current) return
            if (emailParam) {
              setResetEmail(emailParam)
              setEmail(emailParam)
            }
            setMode('expired')
            window.history.replaceState({}, '', window.location.pathname)
          })
      } else {
        setMode('login')
      }
    } else {
      setMode('login')
    }
  }, [])

  const handleResendInvite = async () => {
    if (!mounted.current) return
    setResendLoading(true)
    setResendError('')
    setResendSuccess(false)
    try {
      const resendFn = httpsCallable(functions, 'resendInvite')
      await resendFn({ email: email.trim().toLowerCase() })
      if (mounted.current) {
        setResendSuccess(true)
      }
    } catch (err) {
      console.error('Resend error:', err)
      if (mounted.current) {
        setResendError(err.message || 'Failed to resend invite link. Please try again.')
      }
    } finally {
      if (mounted.current) {
        setResendLoading(false)
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
      if (customToken) {
        // Complete password reset via Cloud Function
        const completeFn = httpsCallable(functions, 'completeResetPassword')
        await completeFn({ token: customToken, newPassword: newPass })

        // Show spinner
        if (mounted.current) setMode('success')

        // Sign in
        await signInWithEmailAndPassword(auth, resetEmail, newPass)

        // Remove query parameters
        window.history.replaceState({}, '', window.location.pathname)
      } else {
        // 1. Set the password using Firebase code
        await confirmPasswordReset(auth, oobCode, newPass)

        // 2. Show spinner
        if (mounted.current) setMode('success')

        // 3. Sign in
        await signInWithEmailAndPassword(auth, resetEmail, newPass)

        // 4. Remove reset query params and let auth listener render the app
        window.history.replaceState({}, '', window.location.pathname)
      }
    } catch (err) {
      console.error('Reset error:', err.code, err.message)
      if (!mounted.current) return
      setLoading(false)
      if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code' || err.message?.includes('expired') || err.message?.includes('not found')) {
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
      await setPersistence(auth, staySignedIn ? browserLocalPersistence : browserSessionPersistence)
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

          {/* Expired */}
          {mode === 'expired' && (
            <div className="text-center py-4">
              <p className="text-3xl mb-3">⏱</p>
              <p className="text-sm font-semibold text-primary mb-2">This link has expired</p>
              
              {resendSuccess ? (
                <div className="bg-ok-soft border border-ok/30 text-ok rounded-xl px-4 py-3 text-sm mb-5 leading-relaxed">
                  ✅ A fresh invitation link has been successfully emailed to <strong>{email}</strong>! Please check your inbox.
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted leading-relaxed mb-5">
                    Invite links expire after 1 hour. Enter your email below to request a new invitation link.
                  </p>
                  
                  {resendError && (
                    <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-3 py-2.5 text-sm mb-4">
                      ⚠️ {resendError}
                    </div>
                  )}

                  <div className="mb-4 text-left">
                    <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                      Email address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className={INPUT}
                    />
                  </div>

                  <button
                    onClick={handleResendInvite}
                    disabled={resendLoading || !email}
                    className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm cursor-pointer border-none mb-5"
                  >
                    {resendLoading ? 'Requesting fresh link…' : '✉️ Resend invitation link'}
                  </button>
                </>
              )}

              <button onClick={() => { setMode('login'); setError(''); setResendSuccess(false); setResendError(''); }}
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
              {/* Stay signed in checkbox */}
              <div className="flex items-center mb-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-muted select-none">
                  <input
                    type="checkbox"
                    checked={staySignedIn}
                    onChange={e => setStaySignedIn(e.target.checked)}
                    className="w-4 h-4 accent-accent rounded border-app bg-raised outline-none cursor-pointer"
                  />
                  Stay signed in
                </label>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm cursor-pointer border-none">
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
                {bioSupported && bioEnabled && (
                  <button
                    type="button"
                    onClick={handleBiometricLogin}
                    disabled={loading}
                    title="Sign in with Face ID / fingerprint"
                    className="w-12 h-12 flex items-center justify-center bg-raised border border-app hover:border-accent rounded-xl text-xl cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    🧬
                  </button>
                )}
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-2xs text-dim mt-6">Young Rembrandts · ShiftHub</p>
      </div>
    </div>
  )
}
