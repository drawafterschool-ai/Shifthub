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

/** Group flat shift array → { [ownerId]: { [dateKey]: Shift[] } } */
export const groupShifts = (shifts = []) => {
  const map = {}
  for (const s of shifts) {
    const owner = s.instructorId || UNASSIGNED
    if (!map[owner])       map[owner] = {}
    if (!map[owner][s.date]) map[owner][s.date] = []
    map[owner][s.date].push(s)
  }
  return map
}
