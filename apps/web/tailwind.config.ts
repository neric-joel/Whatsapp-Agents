import type { Config } from 'tailwindcss'
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Point the `font-sans` / `font-mono` utilities at the self-hosted next/font
      // CSS variables (set on <html> in layout.tsx). Without this, Tailwind's default
      // `.font-sans` (specificity 0,1,0) on <body> overrode the `body{}` element rule
      // (0,0,1) in globals.css, so DM Sans loaded but never actually painted.
      fontFamily: {
        sans: [
          'var(--font-dm-sans)',
          'DM Sans',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'var(--font-jetbrains-mono)',
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
export default config
