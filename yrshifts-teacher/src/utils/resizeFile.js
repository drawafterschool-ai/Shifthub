// ── File resize utility ────────────────────────────────────────────────────
// Images: compressed to max 2MB via canvas
// Videos: validated max 5MB (browser can't transcode video)

export async function resizeFile(file) {
  const IMAGE_MAX = 1.5 * 1024 * 1024  // 1.5 MB
  const VIDEO_MAX = 5 * 1024 * 1024  // 5 MB

  // Video — just enforce size limit
  if (file.type.startsWith('video/')) {
    if (file.size > VIDEO_MAX) {
      throw new Error(`Video "${file.name}" exceeds 5 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`)
    }
    return file
  }

  // Image — compress via canvas if over 1.5 MB
  if (file.type.startsWith('image/')) {
    if (file.size <= IMAGE_MAX) return file  // already small enough

    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        let { width, height } = img

        // Scale down if very large
        const MAX_DIM = 1920
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
          width  = Math.round(width  * ratio)
          height = Math.round(height * ratio)
        }

        canvas.width  = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        // Try reducing quality until under 1.5 MB
        let quality = 0.85
        const tryBlob = () => {
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('Could not compress image')); return }
            if (blob.size <= IMAGE_MAX || quality < 0.3) {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            } else {
              quality -= 0.1
              tryBlob()
            }
          }, 'image/jpeg', quality)
        }
        tryBlob()
      }
      img.onerror = () => reject(new Error('Could not load image'))
      img.src = url
    })
  }

  // Other file types — no restriction
  return file
}

export async function makeThumbnail(file) {
  const THUMB_MAX_SIZE = 150 * 1024; // 150 KB
  const THUMB_TARGET_SIZE = 120 * 1024; // 120 KB
  const MAX_DIM = 480;

  if (!file.type.startsWith('image/')) return null;
  if (file.size <= THUMB_MAX_SIZE) return null; // already small enough, reuse original URL

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img

      // Scale down so max dimension is 480px
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }

      canvas.width  = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      // Reduce quality until under 120 KB
      let quality = 0.8
      const tryBlob = () => {
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Could not create thumbnail')); return }
          if (blob.size <= THUMB_TARGET_SIZE || quality < 0.2) {
            resolve(new File([blob], `thumb_${file.name}`, { type: 'image/jpeg' }))
          } else {
            quality -= 0.1
            tryBlob()
          }
        }, 'image/jpeg', quality)
      }
      tryBlob()
    }
    img.onerror = () => reject(new Error('Could not load image for thumbnail'))
    img.src = url
  })
}
