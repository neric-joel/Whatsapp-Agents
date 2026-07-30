import type { AgentProvider } from '@agentroom/shared'

interface ProviderStyle {
  /**
   * Theme-aware bubble classes only. The bubble's background, text, and border
   * colours belong to the .agent-provider-bubble rules in globals.css, which
   * resolve them per theme; a literal colour utility here would race those rules
   * on specificity and lose the dark themes to near-black-on-near-black text.
   */
  bubble: string
  /** Avatar chip background plus its provider-tinted ring. */
  avatar: string
  nameColor: string
  dot: string
  glow: string
}

export const PROVIDER_STYLES: Record<AgentProvider, ProviderStyle> = {
  claude_code: {
    bubble: 'agent-provider-bubble agent-provider-claude-code',
    // avatar bg darkened to orange-700 so white initials meet WCAG AA (5.18:1);
    // orange-600 (#ea580c) was 3.55:1. (a11y, authenticated-room axe scan)
    avatar: 'bg-[#c2410c] border-[#fdba74]/70',
    nameColor: 'text-[#c2410c]',
    dot: 'bg-[#ea580c]',
    glow: 'shadow-[0_0_14px_rgba(234,88,12,0.16)]',
  },
  codex_cli: {
    bubble: 'agent-provider-bubble agent-provider-codex-cli',
    // avatar bg darkened to cyan-700 so white initials meet WCAG AA (5.35:1);
    // cyan-600 (#0891b2) was 3.68:1. (a11y, authenticated-room axe scan)
    avatar: 'bg-[#0e7490] border-[#67e8f9]/70',
    nameColor: 'text-[#0e7490]',
    dot: 'bg-[#0891b2]',
    glow: 'shadow-[0_0_14px_rgba(8,145,178,0.16)]',
  },
  mock: {
    bubble: 'agent-provider-bubble agent-provider-mock',
    avatar: 'bg-[#64748b] border-[#cbd5e1]/80',
    nameColor: 'text-[#475569]',
    dot: 'bg-[#64748b]',
    glow: 'shadow-[0_0_10px_rgba(100,116,139,0.12)]',
  },
}

export function getProviderStyle(provider: string | null | undefined): ProviderStyle {
  return PROVIDER_STYLES[(provider as AgentProvider) ?? 'mock'] ?? PROVIDER_STYLES.mock
}
