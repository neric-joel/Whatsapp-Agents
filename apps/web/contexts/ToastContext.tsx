'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

import { type ToastItem, type ToastType, ToastViewport } from '@/components/Toast'

interface ToastContextValue {
  showToast: (message: string, type: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function createToastId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastType) => {
      const id = createToastId()
      setToasts((current) => [...current, { id, message, type }])
      window.setTimeout(() => dismissToast(id), 4000)
    },
    [dismissToast],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
