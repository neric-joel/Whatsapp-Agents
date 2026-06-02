import type { AgentProvider } from '@agentroom/shared'

interface ProviderStyle {
  bubble: string
  border: string
  text: string
  avatar: string
  nameColor: string
  dot: string
  glow: string
}

export const PROVIDER_STYLES: Record<AgentProvider, ProviderStyle> = {
  claude_code: {
    bubble: 'bg-[#fff7ed]',
    border: 'border-[#fdba74]/70',
    text: 'text-[#432818]',
    // avatar bg darkened to orange-700 so white initials meet WCAG AA (5.18:1);
    // orange-600 (#ea580c) was 3.55:1. (a11y, authenticated-room axe scan)
    avatar: 'bg-[#c2410c]',
    nameColor: 'text-[#c2410c]',
    dot: 'bg-[#ea580c]',
    glow: 'shadow-[0_0_14px_rgba(234,88,12,0.16)]',
  },
  codex_cli: {
    bubble: 'bg-[#ecfeff]',
    border: 'border-[#67e8f9]/70',
    text: 'text-[#083344]',
    // avatar bg darkened to cyan-700 so white initials meet WCAG AA (5.35:1);
    // cyan-600 (#0891b2) was 3.68:1. (a11y, authenticated-room axe scan)
    avatar: 'bg-[#0e7490]',
    nameColor: 'text-[#0e7490]',
    dot: 'bg-[#0891b2]',
    glow: 'shadow-[0_0_14px_rgba(8,145,178,0.16)]',
  },
  mock: {
    bubble: 'bg-[#f1f5f9]',
    border: 'border-[#cbd5e1]/80',
    text: 'text-[#0f172a]',
    avatar: 'bg-[#64748b]',
    nameColor: 'text-[#475569]',
    dot: 'bg-[#64748b]',
    glow: 'shadow-[0_0_10px_rgba(100,116,139,0.12)]',
  },
}

export function getProviderStyle(provider: string | null | undefined): ProviderStyle {
  return PROVIDER_STYLES[(provider as AgentProvider) ?? 'mock'] ?? PROVIDER_STYLES.mock
}
