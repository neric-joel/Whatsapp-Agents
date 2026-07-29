import './globals.css'
import 'katex/dist/katex.min.css'

import { DM_Sans, JetBrains_Mono } from 'next/font/google'

import AppShell from '@/components/AppShell'
import { ToastProvider } from '@/contexts/ToastContext'
import { jsonForScript } from '@/lib/json-for-script'
import { APP_THEMES, DEFAULT_APP_THEME, THEME_STORAGE_KEY } from '@/lib/themes'

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

const themeInitScript = `(() => {
  try {
    const allowed = ${jsonForScript(APP_THEMES.map((theme) => theme.id))};
    const stored = window.localStorage.getItem(${jsonForScript(THEME_STORAGE_KEY)});
    const theme = allowed.includes(stored) ? stored : ${jsonForScript(DEFAULT_APP_THEME)};
    document.documentElement.dataset.agentroomTheme = theme;
  } catch {
    document.documentElement.dataset.agentroomTheme = ${jsonForScript(DEFAULT_APP_THEME)};
  }
})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-agentroom-theme={DEFAULT_APP_THEME}
      suppressHydrationWarning
      className={`h-full overflow-hidden ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex h-screen flex-row overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--text)]">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  )
}
