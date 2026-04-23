/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: { '2xs': '0.65rem' },
      colors: {
        accent: { DEFAULT: '#4EA8D6', soft: 'rgba(78,168,214,0.12)', dark: '#185FA5' },
      },
      gridTemplateColumns: {
        'schedule': '150px repeat(7, minmax(0, 1fr))',
      },
      animation: {
        'fade-in':  'fadeIn .15s ease',
        'slide-up': 'slideUp .2s ease',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        slideUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } },
      },
    },
  },
  plugins: [],
}
