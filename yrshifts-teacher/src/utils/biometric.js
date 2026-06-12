export async function isBiometricsSupported() {
  try {
    return window.PublicKeyCredential && 
           PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
           await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch (e) {
    return false
  }
}

export async function registerBiometrics(email, password) {
  if (!await isBiometricsSupported()) {
    throw new Error('Biometrics not supported on this device')
  }

  const id = new Uint8Array(16)
  window.crypto.getRandomValues(id)

  const options = {
    publicKey: {
      challenge: window.crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "ShiftHub" },
      user: {
        id: id,
        name: email,
        displayName: email
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },  // ES256
        { type: "public-key", alg: -257 } // RS256
      ],
      timeout: 60000,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required"
      }
    }
  }

  const credential = await navigator.credentials.create(options)
  if (!credential) {
    throw new Error('Failed to create biometric credential')
  }

  const credId = btoa(String.fromCharCode.apply(null, new Uint8Array(credential.rawId)))
  
  localStorage.setItem('shifthub_bio_cred_id', credId)
  localStorage.setItem('shifthub_bio_email', email)
  localStorage.setItem('shifthub_bio_pwd', btoa(password))
  localStorage.setItem('shifthub_bio_enabled', 'true')

  return true
}

export async function authenticateBiometrics() {
  if (!await isBiometricsSupported()) {
    throw new Error('Biometrics not supported')
  }

  const enabled = localStorage.getItem('shifthub_bio_enabled') === 'true'
  const credId = localStorage.getItem('shifthub_bio_cred_id')
  if (!enabled || !credId) {
    throw new Error('Biometrics not registered')
  }

  const rawId = new Uint8Array(atob(credId).split("").map(c => c.charCodeAt(0)))

  const options = {
    publicKey: {
      challenge: window.crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{
        id: rawId,
        type: 'public-key'
      }],
      timeout: 60000,
      userVerification: 'required'
    }
  }

  const assertion = await navigator.credentials.get(options)
  if (!assertion) {
    throw new Error('Biometric authentication failed')
  }

  const email = localStorage.getItem('shifthub_bio_email')
  const pwdB64 = localStorage.getItem('shifthub_bio_pwd')
  if (!email || !pwdB64) {
    throw new Error('Credentials not found')
  }

  return { email, password: atob(pwdB64) }
}

export function disableBiometrics() {
  localStorage.removeItem('shifthub_bio_enabled')
  localStorage.removeItem('shifthub_bio_cred_id')
  localStorage.removeItem('shifthub_bio_email')
  localStorage.removeItem('shifthub_bio_pwd')
}

export function isBiometricsEnabled() {
  return localStorage.getItem('shifthub_bio_enabled') === 'true' && 
         !!localStorage.getItem('shifthub_bio_email')
}
