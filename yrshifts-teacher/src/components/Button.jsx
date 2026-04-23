import { useState } from 'react'

const VARIANTS = {
  primary: 'bg-accent hover:opacity-90 text-white border-accent',
  publish: 'bg-ok    hover:opacity-90 text-white border-ok',
  default: 'bg-card  hover:bg-raised  text-muted  border-app',
  danger:  'bg-card  hover:bg-danger-soft text-danger border-app',
  ghost:   'bg-transparent hover:bg-raised text-muted border-transparent',
}

export default function Button({
  children, variant = 'default', onClick,
  disabled, small, icon, className = '', type = 'button',
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center gap-1.5 font-semibold border rounded-lg
        transition-all duration-100 whitespace-nowrap cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${small ? 'text-xs px-2.5 py-1' : 'text-sm px-3.5 py-1.5'}
        ${VARIANTS[variant] || VARIANTS.default}
        ${className}
      `}
    >
      {icon && <span className={small ? 'text-xs' : 'text-sm'}>{icon}</span>}
      {children}
    </button>
  )
}
