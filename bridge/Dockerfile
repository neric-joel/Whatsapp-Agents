# syntax=docker/dockerfile:1
#
# AgentRoom — bridge daemon production image.
# Multi-stage, non-root. The bridge runs TypeScript directly via tsx (no build step).
#
# Build context MUST be the repo ROOT (pnpm monorepo; depends on @agentroom/shared):
#   docker build -f bridge/Dockerfile -t agentroom-bridge .
#
# TRUST MODEL (see docs/SELF_HOSTING.md): by default this image can only run the
# MOCK adapter. The real adapters (claude / codex / ruflo / myclaude) shell out to
# host-installed CLIs that are NOT present in this image — running them requires a
# derived image that bakes in those CLIs + their provider auth, or running the
# bridge on the host. The bridge holds the Supabase SERVICE_ROLE key: inject it at
# runtime via env/secret, NEVER bake it into the image.

ARG NODE_IMAGE=node:22.13-bookworm-slim

# ── deps: install only the bridge subtree (+ its workspace dep) ────────────────
FROM ${NODE_IMAGE} AS deps
# Install the pinned pnpm directly (avoids the corepack signature-key bug in the
# bundled corepack: "Cannot find matching keyid"). Keep in sync with packageManager.
RUN npm install -g pnpm@11.0.8
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY bridge/package.json ./bridge/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# tsx (a devDependency) is the production runtime here, so dev deps are NOT pruned.
RUN pnpm install --frozen-lockfile --filter bridge...

# ── runner: node_modules from deps + source; run via tsx as a non-root user ────
FROM ${NODE_IMAGE} AS runner
WORKDIR /repo
ENV NODE_ENV=production
# Whole installed tree from deps (keeps the pnpm symlink store intact), then source.
COPY --from=deps --chown=node:node /repo ./
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node bridge ./bridge
USER node
WORKDIR /repo/bridge
# tsx resolves from the repo-root node_modules; mirrors `pnpm --filter bridge start`.
CMD ["/repo/node_modules/.bin/tsx", "src/index.ts"]
