import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  size?: 'sm' | 'md'
}

const variantMap = {
  default: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700'
}

const sizeMap = {
  sm: 'px-2 py-0.5 text-xs rounded-lg',
  md: 'px-2.5 py-1 text-sm rounded-xl'
}

export function Badge({ children, variant = 'default', size = 'md' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-medium ${variantMap[variant]} ${sizeMap[size]}`}>
      {children}
    </span>
  )
}
