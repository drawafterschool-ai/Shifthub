// ─────────────────────────────────────────────────────────────────────────────
// Biometric quick login — WebAuthn PRF edition
//
// The saved password is encrypted with AES-256-GCM. The encryption key is
// derived (HKDF-SHA256) from the WebAuthn PRF extension output, which only
// the platform authenticator can produce, and only after user verification
// (Face ID / fingerprint / Windows Hello). Nothing stored in localStorage is
// usable without a successful biometric assertion on this device.
//
// Legacy note: earlier versions stored the password as base64 plaintext under
// 'shifthub_bio_pwd'. Any device carrying that key has ALL biometric state
// wiped on first use of this module, forcing a clean re-enrollment.
//
// Public API (unchanged from previous version):
//   isBiometricsSupported() → Promise<boolean>
//   registerBiometrics(email, password) → Promise<true>
//   authenticateBiometrics() → Promise<{ email, password }>
//   disableBiometrics() → void
//   isBiometricsEnabled() → boolean
// ─────────────────────────────────────────────────────────────────────────────

const K = {
  enabled:   'shifthub_bio_enabled',
  credId:    'shifthub_bio_cred_id',
  email:     'shifthub_bio_email',
  salt:      'shifthub_bio_salt',
  iv:        'shifthub_bio_iv',
  ct:        'shifthub_bio_ct',
  legacyPwd: 'shifthub_bio_pwd',      // old insecure key — never read, only purged
}

const HKDF_INFO = 'shifthub-bio-v2'

// ── small helpers ────────────────────────────────────────────────────────────

function bufToB64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// If the old plaintext key exists, this device enrolled under the insecure
// format. Purge everything so the user re-enables from a clean slate.
function purgeLegacyIfPresent() {
  if (localStorage.getItem(K.legacyPwd) !== null) {
    disableBiometrics()
  }
}

async function deriveAesKey(prfOutput, saltBytes) {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: new TextEncoder().encode(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// One biometric assertion that both verifies the user AND returns the PRF
// output needed to derive the encryption key.
async function assertAndGetPrf(credIdBytes, saltBytes) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credIdBytes, type: 'public-key' }],
      timeout: 60000,
      userVerification: 'required',
      extensions: { prf: { eval: { first: saltBytes } } },
    },
  })
  if (!assertion) throw new Error('Biometric authentication failed')

  const prf = assertion.getClientExtensionResults()?.prf
  const out = prf?.results?.first
  if (!out) {
    throw new Error('This device does not support secure biometric login (PRF)')
  }
  return new Uint8Array(out)
}

// ── public API ───────────────────────────────────────────────────────────────

export async function isBiometricsSupported() {
  try {
    const base = window.PublicKeyCredential &&
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    if (!base) return false

    // Where the browser can tell us, require PRF support up front. If the
    // capability API is missing or silent, allow — registration will still
    // hard-fail (and store nothing) if PRF turns out to be unsupported.
    if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
      try {
        const caps = await PublicKeyCredential.getClientCapabilities()
        if (caps && caps['extension:prf'] === false) return false
      } catch (e) { /* capability probe failed — fall through to allow */ }
    }
    return true
  } catch (e) {
    return false
  }
}

export async function registerBiometrics(email, password) {
  if (!await isBiometricsSupported()) {
    throw new Error('Biometrics not supported on this device')
  }

  purgeLegacyIfPresent()

  const userId = crypto.getRandomValues(new Uint8Array(16))
  const salt   = crypto.getRandomValues(new Uint8Array(32))

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'ShiftHub' },
      user: { id: userId, name: email, displayName: email },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      timeout: 60000,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: { prf: { eval: { first: salt } } },
    },
  })
  if (!credential) throw new Error('Failed to create biometric credential')

  const ext = credential.getClientExtensionResults()?.prf
  if (ext && ext.enabled === false) {
    throw new Error('This device does not support secure biometric login (PRF)')
  }

  const credIdBytes = new Uint8Array(credential.rawId)

  // Some authenticators return the PRF output at creation; most only return
  // it from a get(). Fall back to one assertion if needed (this can show a
  // second biometric prompt during setup — expected, setup only).
  let prfOutput = ext?.results?.first ? new Uint8Array(ext.results.first) : null
  if (!prfOutput) {
    prfOutput = await assertAndGetPrf(credIdBytes, salt)
  }

  const aesKey = await deriveAesKey(prfOutput, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(password)
  )

  localStorage.setItem(K.credId,  bufToB64(credIdBytes))
  localStorage.setItem(K.email,   email)
  localStorage.setItem(K.salt,    bufToB64(salt))
  localStorage.setItem(K.iv,      bufToB64(iv))
  localStorage.setItem(K.ct,      bufToB64(ct))
  localStorage.setItem(K.enabled, 'true')
  localStorage.removeItem(K.legacyPwd)

  return true
}

export async function authenticateBiometrics() {
  if (!await isBiometricsSupported()) {
    throw new Error('Biometrics not supported')
  }

  purgeLegacyIfPresent()

  const enabled = localStorage.getItem(K.enabled) === 'true'
  const credId  = localStorage.getItem(K.credId)
  const email   = localStorage.getItem(K.email)
  const saltB64 = localStorage.getItem(K.salt)
  const ivB64   = localStorage.getItem(K.iv)
  const ctB64   = localStorage.getItem(K.ct)

  if (!enabled || !credId || !email || !saltB64 || !ivB64 || !ctB64) {
    throw new Error('Biometrics not registered')
  }

  const prfOutput = await assertAndGetPrf(b64ToBytes(credId), b64ToBytes(saltB64))
  const aesKey    = await deriveAesKey(prfOutput, b64ToBytes(saltB64))

  let plaintext
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
      aesKey,
      b64ToBytes(ctB64)
    )
  } catch (e) {
    // Tampered or corrupted data — wipe and force re-enrollment
    disableBiometrics()
    throw new Error('Saved login is invalid — please re-enable quick login')
  }

  return { email, password: new TextDecoder().decode(plaintext) }
}

export function disableBiometrics() {
  localStorage.removeItem(K.enabled)
  localStorage.removeItem(K.credId)
  localStorage.removeItem(K.email)
  localStorage.removeItem(K.salt)
  localStorage.removeItem(K.iv)
  localStorage.removeItem(K.ct)
  localStorage.removeItem(K.legacyPwd)
}

export function isBiometricsEnabled() {
  purgeLegacyIfPresent()
  return localStorage.getItem(K.enabled) === 'true' &&
         !!localStorage.getItem(K.email) &&
         !!localStorage.getItem(K.credId) &&
         !!localStorage.getItem(K.ct)
}
