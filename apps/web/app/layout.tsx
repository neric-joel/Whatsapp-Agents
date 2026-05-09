import './globals.css'
import LeftSidebar from '@/components/LeftSidebar'

export const metadata = { title: 'AgentRoom', description: 'AgentRoom' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <body className="flex flex-row h-screen overflow-hidden bg-[#09090b] font-sans">
        <LeftSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
      </body>
    </html>
  )
}
