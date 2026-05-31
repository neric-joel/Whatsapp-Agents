-- Pre-v1.0 security fix (R1): restrict which columns the browser (the `authenticated`
-- and `anon` roles, via the publishable key) can read from public.agents.
--
-- The `agents_select` RLS policy intentionally keeps agents a GLOBAL registry
-- (`USING (auth.uid() IS NOT NULL)`) so any signed-in user can see the roster. RLS
-- governs ROWS; it does not hide COLUMNS. Phase 11 lets users author `system_prompt`,
-- and `tool_permissions` is sensitive config, so neither must be readable across
-- tenants via the RLS-bound browser client — a malicious user could otherwise run
-- `supabase.from('agents').select('system_prompt')` and read every tenant's prompts.
--
-- Fix: drop the table-level SELECT grant (a table grant overrides a column-level
-- REVOKE) and re-grant SELECT on only the non-sensitive columns to `authenticated`.
-- `anon` gets no grant (it can never pass the agents_select RLS check anyway).
--
-- Safe against the current code: every server read of system_prompt/tool_permissions
-- uses the service-role client (BYPASSRLS, unaffected by these role grants), and the
-- only browser read of agents (AgentsPanel's room_members embed) selects the safe
-- subset. Reversible: `GRANT SELECT ON public.agents TO authenticated;`.

REVOKE SELECT ON public.agents FROM anon, authenticated;

GRANT SELECT (
  id,
  name,
  slug,
  avatar_url,
  provider,
  adapter_type,
  model,
  reply_policy,
  is_active,
  created_by_user_id,
  capabilities,
  created_at,
  updated_at
) ON public.agents TO authenticated;

COMMENT ON COLUMN public.agents.system_prompt IS
  'Sensitive (user-authorable persona text). SELECT revoked from authenticated/anon (R1, migration 20260531000004) — readable only via the service-role API and delivered to a CLI via stdin, never argv.';
COMMENT ON COLUMN public.agents.tool_permissions IS
  'Sensitive (tool auto-approval config). SELECT revoked from authenticated/anon (R1, migration 20260531000004) — service-role only.';
