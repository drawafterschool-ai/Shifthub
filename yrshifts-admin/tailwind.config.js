/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand accent
        accent: {
          DEFAULT: '#4EA8D6',
          soft:    'rgba(78,168,214,0.12)',
          border:  'rgba(78,168,214,0.3)',
          dark:    '#185FA5',
        },
        // App surfaces (dark mode)
        surface: {
          bg:      '#0F1117',
          base:    '#181B25',
          card:    '#1C2030',
          raised:  '#232838',
          border:  '#2A2F40',
          borderLt:'#323848',
        },
        // App surfaces (light mode) — via CSS vars
        // Status colours
        ok:      '#34D399',
        okSoft:  'rgba(52,211,153,0.12)',
        warn:    '#FBBF24',
        warnSoft:'rgba(251,191,36,0.12)',
        danger:  '#F87171',
        dangerSoft:'rgba(248,113,113,0.10)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': '0.65rem',
      },
      gridTemplateColumns: {
        'schedule': '150px repeat(7, minmax(0, 1fr))',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      animation: {
        'fade-in':   'fadeIn 0.15s ease',
        'slide-in':  'slideIn 0.25s ease',
        'slide-up':  'slideUp 0.2s ease',
        'pulse-dot': 'pulseDot 2s infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
        slideIn:  { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        slideUp:  { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
        pulseDot: { '0%,100%': { boxShadow: '0 0 0 0 rgba(248,113,113,0.4)' }, '50%': { boxShadow: '0 0 0 5px rgba(248,113,113,0)' } },
      },
    },
  },
  plugins: [],
}
