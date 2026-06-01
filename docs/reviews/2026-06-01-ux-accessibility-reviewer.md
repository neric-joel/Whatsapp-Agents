# UI/UX & Accessibility Review — AgentRoom WS-UX + WS2 (2026-06-01)

## Executive Summary

Reviewed the AgentRoom product validation work on `feat/product-validation-v1` across layout, themes, settings (Providers panel), messages, sidebar, and auth. Automated axe-core scanning confirms 0 serious/critical WCAG violations on all 7 themes + Settings; Lighthouse accessibility = 100. Manual structural review finds 2 Medium issues and 5 Low issues—all actionable, most non-blocking.

---

## Triage Table

| SEV | Title | Location | Recommended Fix | Accept/Defer |
|-----|-------|----------|-----------------|--------------|
| MEDIUM | Delete credential lacks confirmation | ProvidersPanel.tsx:100–108, 255–262 | Add window.confirm before DELETE fetch to match LeftSidebar pattern (lines 232, 262) | ACCEPT (v1.0 blocker) |
| MEDIUM | Checkbox "Make default" lacks explicit label | ProvidersPanel.tsx:183–190 | Add aria-label to input OR restructure as label htmlFor + input id for consistency | DEFER (polish) |
| LOW | Form error/success messages lack aria-live | ProvidersPanel.tsx:192–201 | Add aria-live="assertive" to formError, aria-live="polite" to notice (matches Toast pattern) | DEFER (role="alert"/"status" sufficient) |
| LOW | Mention dropdown no arrow-key navigation | ComposeBox.tsx:447–464 | Convert to role="listbox", add arrow-up/down handlers, aria-activedescendant | DEFER (mouse works; keyboard enhancement) |
| LOW | Send button missing aria-busy/pending label | ComposeBox.tsx:532–538 | Add aria-busy={sending \|\| uploading} and "Sending..." label (matches ProvidersPanel line 206) | DEFER (disabled state visible) |
| LOW | Toast dismiss focus not explicitly restored | Toast.tsx:32–39 | Acceptable as-is (aria-live already announces removal). Optional: add focus restore on dismiss | ACCEPT as-is |

---

## Key Findings

### WCAG 2.1 Level AA: COMPLIANT
- axe-core 0 violations on all 7 themes + Settings page (e2e/a11y.spec.ts)
- Lighthouse accessibility 100
- Color contrast AA on all themes (--muted darkened per globals.css:85, 124, 182)
- Keyboard navigation: Tab/Enter/Escape working
- Focus visible on all interactive elements
- prefers-reduced-motion honored (globals.css:65–74)

### Must Fix Before v1.0
- **Delete credential confirmation (M2)**: Destructive action without safeguard. Add window.confirm() to onDelete handler (ProvidersPanel.tsx:100–108). Matches established UX pattern in LeftSidebar.

### Nice-to-Have Enhancements
- Arrow-key navigation in @-mention dropdown (L4)
- aria-busy or "Sending..." label on send button (L5)
- aria-live on form messages (L3)
- Consistent label structure for checkbox (M1)

---

## Component Status

| Component | Grade | Notes |
|-----------|-------|-------|
| layout.tsx | ✓ | Self-hosted fonts, lang="en", no CSP issues |
| globals.css | ✓ | 7 themes with AA contrast, reduced-motion support |
| auth/page.tsx | ✓ | WAI-ARIA tabs pattern, roving tabindex, focus restoration |
| LeftSidebar.tsx | ✓ | Dialog focus trap, confirm patterns, aria-expanded correct |
| RoomHeader.tsx | ✓ | Semantic dropdown, role groups, agent status clear |
| ComposeBox.tsx | ⚠ | L4 mention nav + L5 aria-busy (enhancements) |
| MessageBubble.tsx | ✓ | Actions visible on hover/focus, time stamps clear |
| ProvidersPanel.tsx | ⚠ | M2 delete confirmation + L3 aria-live + M1 label clarity |
| MessageTimeline.tsx | ✓ | role="log" correct, prefers-reduced-motion honored |
| Toast.tsx | ✓ | role="alert"/"status", aria-live correct pattern |

---

## Automation Verification

| Gate | Status | Evidence |
|------|--------|----------|
| axe-core auth page (WCAG AA) | PASS | e2e/a11y.spec.ts:43–52 |
| axe-core auth signup | PASS | e2e/a11y.spec.ts:54–62 |
| axe-core authenticated room | PASS | e2e/a11y.spec.ts:67–82 |
| axe-core all 7 themes | PASS | e2e/a11y.spec.ts:87–103 |
| axe-core Settings/Providers | PASS | e2e/a11y.spec.ts:106–117 |
| Lighthouse a11y | 100 | Per project context |
| Contrast (AA) all themes | PASS | CSS vars verified |
| Keyboard (Tab/Enter/Escape) | PASS | Tested in compose + auth |
| Focus ring visible | PASS | All interactive elements |
| Reduced motion respected | PASS | globals.css:65–74 |

---

