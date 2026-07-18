import { type ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}

const variantMap = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
  secondary: 'bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 active:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200'
}

const sizeMap = {
  sm: 'px-3 py-1.5 text-sm rounded-xl',
  md: 'px-5 py-3 text-sm rounded-2xl',
  lg: 'px-6 py-4 text-base rounded-2xl'
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button'
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center gap-2 font-semibold
        transition-all duration-150 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none
        hover:-translate-y-0.5 active:translate-y-0
        ${variantMap[variant]}
        ${sizeMap[size]}
        ${className}
      `}
    >
      {children}
    </button>
  )
}
