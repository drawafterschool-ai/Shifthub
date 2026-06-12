export const TIME_OPTS = []
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    const h12   = h === 0 ? 12 : h > 12 ? h - 12 : h
    const mins  = m === 0 ? '00' : '30'
    const period = h < 12 ? 'AM' : 'PM'
    TIME_OPTS.push(`${h12}:${mins} ${period}`)
  }
}

export const timeTo24 = (t) => {
  if (!t || typeof t !== 'string') return 0
  const parts = t.trim().split(' ')
  const [time, period] = parts
  if (!time) return 0
  let [h, m] = time.split(':').map(Number)
  if (isNaN(h)) h = 0
  if (isNaN(m)) m = 0
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return h * 60 + m
}

export const calcHours = (start, end) => {
  let a = timeTo24(start)
  let b = timeTo24(end)
  if (b <= a) b += 1440
  const d   = b - a
  const hrs = Math.floor(d / 60)
  const mins = d % 60
  return {
    text:    mins ? `${hrs}h ${mins}m` : `${hrs}h`,
    decimal: +(d / 60).toFixed(2),
  }
}
