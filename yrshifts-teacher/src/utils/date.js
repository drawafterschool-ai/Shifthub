export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const toKey = (d) => d.toISOString().slice(0, 10)

export const addDays = (d, n) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export const getWeekDates = (offset = 0) => {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diff + offset * 7)
  mon.setHours(0, 0, 0, 0)
  return DAYS.map((_, i) => addDays(mon, i))
}

export const getMonthDates = (offset = 0) => {
  const now   = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const startDay = first.getDay() || 7
  const start = addDays(first, 1 - startDay)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return { cells, month: first.getMonth(), year: first.getFullYear() }
}

export const fmtDate = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const fmtDateLong = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export const isToday = (d) => {
  const n = new Date()
  return d.getDate() === n.getDate() &&
    d.getMonth()    === n.getMonth() &&
    d.getFullYear() === n.getFullYear()
}
