import './globals.css'
import LeftSidebar from '@/components/LeftSidebar'
import { ToastProvider } from '@/contexts/ToastContext'

export const metadata = { title: 'AgentRoom', description: 'AgentRoom' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <body className="flex flex-row h-screen overflow-hidden bg-white font-sans">
        <ToastProvider>
          <LeftSidebar />
          <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
        </ToastProvider>
      </body>
    </html>
  )
}
