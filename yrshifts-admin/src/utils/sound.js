export const playNotificationSound = (soundType = null) => {
  const type = soundType || localStorage.getItem('shifthub_notif_sound') || 'default'
  if (type === 'none') return

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()

    // Resume context if suspended (browser security rules)
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    let maxEnd = 0
    const playTone = (freq, duration, oscType = 'sine', startTime = 0, volume = 0.1) => {
      maxEnd = Math.max(maxEnd, startTime + duration)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = oscType
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime)

      gain.gain.setValueAtTime(volume, ctx.currentTime + startTime)
      // Exponential decay to avoid clicking
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startTime + duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime + startTime)
      osc.stop(ctx.currentTime + startTime + duration)
    }

    if (type === 'default') {
      // Pleasant ping: a sine wave at 880Hz decaying over 0.4s
      playTone(880, 0.4, 'sine', 0, 0.15)
    } else if (type === 'chime') {
      // Two-tone chime: 523Hz (C5) for 0.15s, then 784Hz (G5) for 0.4s
      playTone(523, 0.15, 'sine', 0, 0.12)
      playTone(784, 0.4, 'sine', 0.1, 0.12)
    } else if (type === 'tink') {
      // Short metallic tink: 1500Hz triangle wave decaying very fast
      playTone(1500, 0.08, 'triangle', 0, 0.1)
    } else if (type === 'glass') {
      // Resonant glass ring: main freq 1046.5Hz plus high overtones
      playTone(1046.5, 0.6, 'sine', 0, 0.1)
      playTone(1568, 0.4, 'sine', 0, 0.05)
      playTone(2093, 0.3, 'sine', 0, 0.03)
    }

    // Close context after playback completes to release hardware resources
    setTimeout(() => {
      ctx.close().catch(() => {})
    }, (maxEnd * 1000) + 100)
  } catch (e) {
    console.error('Failed to play notification sound:', e)
  }
}
