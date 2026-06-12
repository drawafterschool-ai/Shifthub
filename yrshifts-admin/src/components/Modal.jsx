export default function Modal({ children, onClose, width = 'max-w-sm', zIndex = 'z-[1100]' }) {
  return (
    <div className={`fixed inset-0 ${zIndex} overflow-y-auto p-4 md:p-6 flex items-start justify-center`}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} bg-card border border-app rounded-2xl p-6 shadow-2xl animate-fade-in my-auto`}>
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h3 className="text-lg font-bold text-primary">{title}</h3>
      <button onClick={onClose} className="text-dim hover:text-muted text-xl leading-none">×</button>
    </div>
  )
}

export function ModalFooter({ children }) {
  return <div className="flex justify-end gap-2 mt-5">{children}</div>
}
