import { useEffect, useRef } from 'react'
import '@khmyznikov/pwa-install'

// Props:
//   manifestUrl — e.g. "/admin/manifest.json" or "/app/manifest.json"
//   appName     — e.g. "ShiftHub Admin" or "ShiftHub"
//   icon        — e.g. "/yr_logo.jpg"
export default function InstallBanner({ manifestUrl, appName, icon }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onSuccess = async () => {
      // After installing on Android, prompt for notification permission
      try {
        if (typeof Notification === 'undefined') return
        if (Notification.permission === 'granted') return

        // Small delay so the install dialog closes first
        await new Promise(r => setTimeout(r, 1500))
        const permission = await Notification.requestPermission()

        if (permission === 'granted' && 'serviceWorker' in navigator) {
          // Register the messaging SW to activate push
          await navigator.serviceWorker.ready
        }
      } catch(e) {
        console.log('Notification prompt error:', e)
      }
    }

    el.addEventListener('pwa-install-success-event', onSuccess)
    return () => el.removeEventListener('pwa-install-success-event', onSuccess)
  }, [])

  return (
    <pwa-install
      ref={ref}
      manifest-url={manifestUrl}
      name={appName}
      icon={icon}
      install-description="Install the app to receive shift notifications and alerts"
      use-local-storage
    />
  )
}
