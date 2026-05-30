# Untracked-Files Load-Bearing Check — Phase 0 — 2026-05-30

Assets used: `Explore` agent (Grep/Read/Glob/Bash). Lead-verified: `next build` succeeds with all present.

## Per-file verdict (all LOAD-BEARING)
- `apps/web/app/api/agents/route.ts` — Next route entrypoint (used by `RoomAgentsPanel.tsx:52`)
- `apps/web/app/api/rooms/[roomId]/route.ts` — Next route entrypoint (DELETE)
- `apps/web/app/api/rooms/[roomId]/members/route.ts` — Next route (GET/POST; `RoomAgentsPanel.tsx:50-51`)
- `apps/web/app/api/rooms/[roomId]/members/[memberId]/route.ts` — Next route (DELETE; `RoomAgentsPanel.tsx:109`)
- `apps/web/app/login/page.tsx` — Next page (routed from `app/rooms/[roomId]/page.tsx:30`)
- `apps/web/components/ActiveRunsPanel.tsx` — imported by `rooms/[roomId]/page.tsx:8`
- `apps/web/components/AgentsPanel.tsx` — imported by `rooms/[roomId]/page.tsx:7` + `RoomHeader.tsx`
- `apps/web/components/FilesPanel.tsx` — imported by `rooms/[roomId]/page.tsx:10`
- `apps/web/components/RoomAgentsPanel.tsx` — imported by `RoomHeader.tsx:4`
- `apps/web/lib/api-client.ts` — imported by `RoomAgentsPanel.tsx:4` + test
- `apps/web/lib/__tests__/api-client.test.ts` — tests `getApiErrorMessage` + `addRoomAgentSchema`

## Coherence
YES — the 11 untracked + the modified tracked files (page.tsx, RoomHeader.tsx, RoomAgentsPanel.tsx,
ComposeBox, LeftSidebar, MessageTimeline, PinnedItemsPanel, useRooms, api-validation) are one
coherent agent-room-management wave. Safe to commit together as the P0 baseline.

## Broken imports / risks
NONE — all imports resolve; `next build` exits 0. Caveat (from dead-code review): the
health-route edit is a regression and `api.ts` is dead; handle those before/with the commit.
