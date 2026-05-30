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
    avatar: 'bg-[#ea580c]',
    nameColor: 'text-[#c2410c]',
    dot: 'bg-[#ea580c]',
    glow: 'shadow-[0_0_14px_rgba(234,88,12,0.16)]',
  },
  codex_cli: {
    bubble: 'bg-[#ecfeff]',
    border: 'border-[#67e8f9]/70',
    text: 'text-[#083344]',
    avatar: 'bg-[#0891b2]',
    nameColor: 'text-[#0e7490]',
    dot: 'bg-[#0891b2]',
    glow: 'shadow-[0_0_14px_rgba(8,145,178,0.16)]',
  },
  ruflo: {
    bubble: 'bg-[#f5f3ff]',
    border: 'border-[#c4b5fd]/70',
    text: 'text-[#2e1065]',
    avatar: 'bg-[#7c3aed]',
    nameColor: 'text-[#7c3aed]',
    dot: 'bg-[#7c3aed]',
    glow: 'shadow-[0_0_14px_rgba(124,58,237,0.16)]',
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
