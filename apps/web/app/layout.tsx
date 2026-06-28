import './globals.css'
import 'katex/dist/katex.min.css'

import { DM_Sans, JetBrains_Mono } from 'next/font/google'

import AppShell from '@/components/AppShell'
import { ToastProvider } from '@/contexts/ToastContext'

// Self-hosted via next/font (downloaded at build, served from /_next). This removes the
// runtime request to fonts.googleapis.com/fonts.gstatic.com that the app's tight CSP
// (font-src 'self'; style-src 'self') was correctly blocking — so the brand typography
// now actually loads — while keeping the CSP locked to 'self' (no external font origins),
// eliminating render-blocking + FOUT, and not leaking the visitor IP to Google.
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' })
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export const metadata = { title: 'AgentRoom', description: 'AgentRoom' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full overflow-hidden ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="flex h-screen flex-row overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--text)]">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  )
}
