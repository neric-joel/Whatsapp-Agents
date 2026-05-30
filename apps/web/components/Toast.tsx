'use client'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface ToastProps {
  toast: ToastItem
  onDismiss: (id: string) => void
}

const toneClass: Record<ToastType, string> = {
  success: 'border-green-500',
  error: 'border-red-500',
  info: 'border-[#7C3AED]',
}

function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div
      className={`animate-[toast-life_4000ms_ease-in-out_forwards] rounded-md border-l-4 ${toneClass[toast.type]} bg-white px-4 py-3 text-sm text-gray-900 shadow-lg transition-opacity`}
      role="status"
    >
      <div className="flex min-w-64 max-w-sm items-start gap-3">
        <p className="flex-1 leading-5">{toast.message}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-gray-400 transition-colors hover:text-gray-700"
          aria-label="Dismiss notification"
        >
          x
        </button>
      </div>
    </div>
  )
}

interface ToastViewportProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-3">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
