import { useRef } from 'react'
import { getInitials } from '../utils/helpers'

export default function Avatar({ firstName, lastName, color, photo, icon, size = 32, onUpload }) {
  const fileRef = useRef(null)

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    onUpload(url)
    URL.revokeObjectURL(url)
  }

  const sizeStyle = { width: size, height: size, fontSize: size * 0.36 }
  const cursor    = onUpload ? 'cursor-pointer' : 'cursor-default'

  if (photo) {
    return (
      <div className={`relative flex-shrink-0 rounded-full overflow-hidden ${cursor}`}
        style={sizeStyle} onClick={() => onUpload && fileRef.current?.click()}>
        <img src={photo} alt="" className="w-full h-full object-cover" />
        {onUpload && <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />}
      </div>
    )
  }

  return (
    <div
      onClick={() => onUpload && fileRef.current?.click()}
      className={`flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white relative ${cursor}`}
      style={{ ...sizeStyle, background: color || '#4EA8D6' }}
    >
      {icon ? (
        <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>{icon}</span>
      ) : (
        getInitials(firstName, lastName)
      )}
      {onUpload && (
        <>
          <div
            className="absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center text-white"
            style={{ width: size * 0.36, height: size * 0.36, background: 'var(--accent)', fontSize: size * 0.2, border: `2px solid var(--surface)` }}
          >📷</div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </>
      )}
    </div>
  )
}
