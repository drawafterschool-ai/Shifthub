import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/admin',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split Firebase into per-service chunks so only used services load
          if (id.includes('node_modules/firebase')) {
            if (id.includes('/auth'))      return 'firebase-auth'
            if (id.includes('/firestore')) return 'firebase-firestore'
            if (id.includes('/storage'))   return 'firebase-storage'
            if (id.includes('/messaging')) return 'firebase-messaging'
            return 'firebase-core'
          }
          // React + router together (always needed)
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router')) return 'vendor-react'
          // Zustand (tiny, but separate so it caches independently)
          if (id.includes('node_modules/zustand')) return 'vendor-zustand'
          // Sanitisation library only used by WeeklyBuzz
          if (id.includes('node_modules/dompurify')) return 'vendor-dompurify'
        },
      },
    },
  },
})
