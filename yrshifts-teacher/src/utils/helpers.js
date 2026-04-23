export const uid = () => 's' + Math.random().toString(36).slice(2, 9)

export const getInitials = (first = '', last = '') =>
  ((first[0] || '') + (last[0] || '')).toUpperCase()

export const formatPhone = (p = '') => {
  const d = p.replace(/\D/g, '')
  return d.length === 10
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : p
}

export const STUDENTS_OPTS = Array.from({ length: 38 }, (_, i) => i + 3)
