export type AgentProvider = 'claude_code' | 'codex_cli' | 'ruflo' | 'mock'

export interface ProviderStyle {
  bubble: string
  border: string
  nameColor: string
  dot: string
  glow: string
}

export const PROVIDER_STYLES: Record<AgentProvider, ProviderStyle> = {
  claude_code: {
    bubble: 'bg-[#1c1410]',
    border: 'border-[#92400e]/30',
    nameColor: 'text-[#f59e0b]',
    dot: 'bg-[#f59e0b]',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]',
  },
  codex_cli: {
    bubble: 'bg-[#0c1618]',
    border: 'border-[#0e7490]/30',
    nameColor: 'text-[#06b6d4]',
    dot: 'bg-[#06b6d4]',
    glow: 'shadow-[0_0_12px_rgba(6,182,212,0.15)]',
  },
  ruflo: {
    bubble: 'bg-[#1a0f1e]',
    border: 'border-[#7e22ce]/30',
    nameColor: 'text-[#c084fc]',
    dot: 'bg-[#c084fc]',
    glow: 'shadow-[0_0_12px_rgba(192,132,252,0.15)]',
  },
  mock: {
    bubble: 'bg-[#1a1a1a]',
    border: 'border-[#3f3f46]/30',
    nameColor: 'text-[#a1a1aa]',
    dot: 'bg-[#a1a1aa]',
    glow: 'shadow-[0_0_8px_rgba(161,161,170,0.1)]',
  },
}

export function getProviderStyle(provider: string | null | undefined): ProviderStyle {
  return PROVIDER_STYLES[(provider as AgentProvider) ?? 'mock'] ?? PROVIDER_STYLES.mock
}
