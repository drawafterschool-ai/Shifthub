import { create } from 'zustand'

const THEMES = [
  { id: 'default',  label: 'ShiftHub',   dot: '#4EA8D6', description: 'Default dark' },
  { id: 'linear',   label: 'Linear',     dot: '#5e6ad2', description: 'Near-black, lavender' },
  { id: 'vercel',   label: 'Vercel',     dot: '#0070f3', description: 'Clean white, blue' },
  { id: 'stripe',   label: 'Stripe',     dot: '#533afd', description: 'Light, indigo' },
  { id: 'supabase', label: 'Supabase',   dot: '#3ecf8e', description: 'Dark, emerald' },
  { id: 'notion',   label: 'Notion',     dot: '#5645d4', description: 'Clean white, purple' },
]

const STORAGE_KEY = 'shifthub-theme'

const applyTheme = (id) => {
  if (id === 'default') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', id)
  }
}

const useThemeStore = create((set) => ({
  theme:  localStorage.getItem(STORAGE_KEY) || 'default',
  themes: THEMES,

  setTheme(id) {
    localStorage.setItem(STORAGE_KEY, id)
    applyTheme(id)
    set({ theme: id })
  },

  init() {
    const saved = localStorage.getItem(STORAGE_KEY) || 'default'
    applyTheme(saved)
    set({ theme: saved })
  },
}))

export default useThemeStore
