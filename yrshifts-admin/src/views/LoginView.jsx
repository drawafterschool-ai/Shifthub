import { useState, useEffect }             from 'react'
import { useNavigate }                     from 'react-router-dom'
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth'
import useAuthStore                        from '../stores/useAuthStore'
import { auth }                            from '../utils/firebase'
import { isBiometricsSupported, authenticateBiometrics, isBiometricsEnabled } from '../utils/biometric'

export default function LoginView() {
  const navigate = useNavigate()
  const { user, userProfile, loading: authLoading } = useAuthStore()

  // When auth state resolves with a logged-in user, navigate away
  useEffect(() => {
    if (!authLoading && user && userProfile) {
      navigate('/schedule', { replace: true })
    }
  }, [authLoading, user, userProfile, navigate])

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [staySignedIn, setStaySignedIn] = useState(true)
  const [bioSupported, setBioSupported] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)

  const handleBiometricLogin = async () => {
    setError('')
    setLoading(true)
    try {
      const creds = await authenticateBiometrics()
      await signInWithEmailAndPassword(auth, creds.email, creds.password)
    } catch (err) {
      console.warn('Biometric login failed:', err)
      setError(err.message || 'Biometric authentication failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function checkBio() {
      const supported = await isBiometricsSupported()
      setBioSupported(supported)
      const enabled = isBiometricsEnabled()
      setBioEnabled(enabled)
      
      if (supported && enabled) {
        // Safe delayed prompt for a seamless PWA experience
        setTimeout(() => {
          handleBiometricLogin()
        }, 600)
      }
    }
    checkBio()
  }, [])

  if (authLoading) return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#0F1117] text-white p-4 relative overflow-hidden">
      <div className="absolute -top-24 -left-24 w-80 h-80 bg-indigo-600/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-teal-500/20 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col items-center text-center px-8">
        <div className="relative mb-6 group">
          <div className="absolute inset-0 bg-indigo-500/25 rounded-3xl blur-xl" />
          <div className="relative w-24 h-24 rounded-3xl bg-indigo-950/40 border border-indigo-500/30 backdrop-blur-md flex items-center justify-center p-2.5 shadow-2xl overflow-hidden">
            <img src="/admin/yr_logo.jpg" alt="YR Logo" className="w-full h-full object-cover rounded-2xl shadow-md" />
          </div>
        </div>

        <h1 className="text-3xl font-extrabold font-display tracking-tight text-white mb-1">
          ShiftHub
        </h1>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-10">
          Young Rembrandts - Minnesota &amp; Western Wisconsin
        </p>

        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500/20 border-t-indigo-400 animate-spin" />
          <p className="text-xs font-semibold text-gray-400 tracking-wide">
            Loading your profile…
          </p>
        </div>
      </div>

      <div className="absolute bottom-6 text-[10px] text-gray-500 font-mono tracking-wider">
        v2.0 • ShiftHub Suite - Giordano Fontana
      </div>
    </div>
  )

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await setPersistence(auth, staySignedIn ? browserLocalPersistence : browserSessionPersistence)
      const normalizedEmail = email.trim().toLowerCase()
      await signInWithEmailAndPassword(auth, normalizedEmail, password)
      // useEffect above will navigate once auth state resolves
    } catch (err) {
      setError(err.message.replace('Firebase:', '').trim())
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[#0F1117]">
      <div className="w-full max-w-sm mx-4">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4 group">
            <div className="absolute inset-0 bg-indigo-500/25 rounded-3xl blur-xl" />
            <div className="relative w-20 h-20 rounded-3xl bg-indigo-950/40 border border-indigo-500/30 backdrop-blur-md flex items-center justify-center p-2 shadow-2xl overflow-hidden">
              <img src="/admin/yr_logo.jpg" alt="YR Logo" className="w-full h-full object-cover rounded-2xl shadow-md" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">ShiftHub</h1>
          <p className="text-xs text-muted mt-1 uppercase tracking-wider text-center">Young Rembrandts - Minnesota &amp; Western Wisconsin</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-app rounded-2xl p-8">
          {error && (
            <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm mb-5">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                placeholder="admin@youngrembrandts.com"
                className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"
              />
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

            <div className="flex items-center gap-2 mt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-opacity"
              >
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
        </div>

        <p className="text-center text-2xs text-dim mt-6">
          Young Rembrandts · ShiftHub v2
        </p>
      </div>
    </div>
  )
}
