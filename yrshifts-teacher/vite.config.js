import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) {
            if (id.includes('/auth'))      return 'firebase-auth'
            if (id.includes('/firestore')) return 'firebase-firestore'
            if (id.includes('/storage'))   return 'firebase-storage'
            if (id.includes('/messaging')) return 'firebase-messaging'
            return 'firebase-core'
          }
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('node_modules/zustand'))   return 'vendor-zustand'
          if (id.includes('node_modules/dompurify')) return 'vendor-dompurify'
        },
      },
    },
  },
})
