import { uid } from './helpers'

export const UNASSIGNED = 'UNASSIGNED'

export const makeShift = (overrides = {}) => ({
  id:                 uid(),
  seriesId:           uid(),   // always set — required for delete/edit series
  title:              '',
  job:                '',
  address:            '',
  note:               '',
  instructorId:       null,
  claimable:          false,
  date:               '',
  start:              '2:00 PM',
  end:                '3:00 PM',
  status:             'draft',
  attachments:        [],
  students:           null,
  skipDates:          [],
  confirmationStatus: null,
  ...overrides,
})

function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  const clean = timeStr.toLowerCase().replace(/\s+/g, '')
  const match = clean.match(/^(\d{1,2}):(\d{2})(am|pm)$/)
  if (!match) return 0
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const ampm = match[3]
  if (ampm === 'pm' && hours < 12) hours += 12
  if (ampm === 'am' && hours === 12) hours = 0
  return hours * 60 + minutes
}

/** Group flat shift array → { [ownerId]: { [dateKey]: Shift[] } } */
export const groupShifts = (shifts = [], activeIds = []) => {
  const map = {}
  const activeSet = new Set(activeIds.map(String))
  for (const s of shifts) {
    const isAssigned = s.instructorId && (activeIds.length === 0 || activeSet.has(String(s.instructorId)))
    const owner = isAssigned ? String(s.instructorId) : UNASSIGNED
    if (!map[owner])       map[owner] = {}
    if (!map[owner][s.date]) map[owner][s.date] = []
    map[owner][s.date].push(s)
  }

  // Sort each array of shifts chronologically by start time
  for (const owner in map) {
    for (const date in map[owner]) {
      map[owner][date].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
    }
  }

  return map
}
