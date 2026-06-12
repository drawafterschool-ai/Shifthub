import { calcHours } from './time'

/**
 * Export payroll CSV for a specific date range.
 * schedule: { [ownerId]: { [dateKey]: Shift[] } }
 */
export function exportPeriodCSV(schedule, instructors, jobs, startKey, endKey, label) {
  const rows = [
    [`Payroll Export — ${label}`],
    [],
    ['Instructor', 'Date', 'Day', 'Start', 'End', 'Hours', 'Students', 'Rate/hr', 'Total', 'Job', 'Session', 'Address', 'Note'],
  ]

  let grandHours = 0
  let grandPay   = 0

  instructors.forEach(inst => {
    const ownerShifts = schedule[String(inst.id)] || {}
    const instRows    = []
    let   instHours   = 0
    let   instPay     = 0

    Object.entries(ownerShifts).forEach(([dateKey, arr]) => {
      if (dateKey < startKey || dateKey > endKey) return

      arr.forEach(s => {
        if (s.status === 'cancelled' || s.job === 'cancelled') return
        if (s.confirmationStatus !== 'confirmed') return

        const job    = jobs.find(j => j.id === s.job)
        const calc   = calcHours(s.start, s.end)
        const hours  = s.hoursWorked != null
          ? Number(s.hoursWorked)
          : (calc?.decimal ?? 0)
        const rate   = Number(s.appliedRate  || 0)
        const total  = Number(s.totalPay     || 0)
        const day    = new Date(dateKey + 'T12:00:00')
          .toLocaleDateString('en-US', { weekday: 'short' })

        instHours += hours
        instPay   += total

        instRows.push([
          csvCell(`${inst.firstName} ${inst.lastName}`),
          dateKey,
          day,
          s.start  || '',
          s.end    || '',
          hours.toFixed(2),
          s.students || '0',
          `$${rate.toFixed(2)}`,
          `$${total.toFixed(2)}`,
          csvCell(job?.title || job?.label || s.job || ''),
          csvCell(s.title   || ''),
          csvCell(s.address || ''),
          csvCell(s.note    || ''),
        ])
      })
    })

    if (!instRows.length) return

    rows.push(...instRows)
    rows.push([
      csvCell(`  ${inst.firstName} ${inst.lastName} subtotal`),
      '', '', '', '',
      instHours.toFixed(2), '', '',
      `$${instPay.toFixed(2)}`,
      '', '', '', '',
    ])
    rows.push([])

    grandHours += instHours
    grandPay   += instPay
  })

  // Unassigned / open shifts
  const unassigned = schedule['UNASSIGNED'] || {}
  const openRows   = []
  Object.entries(unassigned).forEach(([dateKey, arr]) => {
    if (dateKey < startKey || dateKey > endKey) return
    arr.forEach(s => {
      if (s.status === 'cancelled' || s.job === 'cancelled') return
      
      const calc  = calcHours(s.start, s.end)
      const hours = calc?.decimal ?? 0
      const day   = new Date(dateKey + 'T12:00:00')
        .toLocaleDateString('en-US', { weekday: 'short' })
      openRows.push([
        'Unassigned / Open', dateKey, day,
        s.start || '', s.end || '',
        hours.toFixed(2), s.students || '0',
        '$0.00', '$0.00',
        '', csvCell(s.title || ''), '', '',
      ])
    })
  })
  if (openRows.length) {
    rows.push(['UNASSIGNED / OPEN SHIFTS'])
    rows.push(...openRows)
    rows.push([])
  }

  rows.push(['GRAND TOTAL', '', '', '', '', grandHours.toFixed(2), '', '', `$${grandPay.toFixed(2)}`])

  const csv  = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `payroll-${startKey}-to-${endKey}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export payroll CSV for a specific month.
 * (Backward compatible wrapper)
 */
export function exportCSV(schedule, instructors, jobs, year, month) {
  const monthStr  = String(month).padStart(2, '0')
  const startKey  = `${year}-${monthStr}-01`
  const lastDay   = new Date(year, month, 0).getDate()
  const endKey    = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`
  const monthName = new Date(year, month - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  
  return exportPeriodCSV(schedule, instructors, jobs, startKey, endKey, monthName)
}

/**
 * Export payroll CSV directly to QuickBooks Online Time Activities import format.
 */
export function exportQuickBooksCSV(schedule, instructors, jobs, startKey, endKey, label) {
  const rows = [
    ['TxnDate', 'Name', 'Duration', 'HourlyRate', 'Customer', 'ServiceItem', 'Description', 'BillableStatus'],
  ]

  instructors.forEach(inst => {
    const ownerShifts = schedule[String(inst.id)] || {}
    Object.entries(ownerShifts).forEach(([dateKey, arr]) => {
      if (dateKey < startKey || dateKey > endKey) return

      arr.forEach(s => {
        if (s.status === 'cancelled' || s.job === 'cancelled') return
        if (s.confirmationStatus !== 'confirmed') return

        const job    = jobs.find(j => j.id === s.job)
        const calc   = calcHours(s.start, s.end)
        const hours  = s.hoursWorked != null
          ? Number(s.hoursWorked)
          : (calc?.decimal ?? 0)
        const rate   = Number(s.appliedRate  || 0)
        const qbDate = formatQBDate(dateKey)

        rows.push([
          qbDate,
          csvCell(`${inst.firstName} ${inst.lastName}`),
          hours.toFixed(2),
          rate.toFixed(2),
          csvCell(s.title || ''),
          csvCell(job?.title || job?.label || s.job || 'Teach'),
          csvCell(s.note || s.address || ''),
          'NotBillable',
        ])
      })
    })
  })

  const csv  = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `quickbooks-payroll-${startKey}-to-${endKey}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function formatQBDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${m}/${d}/${y}`
}

// Wrap a cell value in quotes if it contains commas or quotes
function csvCell(val) {
  const s = String(val || '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

