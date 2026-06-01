# syntax=docker/dockerfile:1
#
# AgentRoom — web (Next.js) production image.
# Multi-stage, non-root, Next.js standalone output for a small runtime image.
#
# IMPORTANT: the build context MUST be the repo ROOT — this is a pnpm monorepo and
# the web app depends on the raw-TypeScript workspace package @agentroom/shared:
#
#   docker build -f apps/web/Dockerfile -t agentroom-web \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<proj>.supabase.co" \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="<publishable-key>" .
#
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time (and the CSP
# connect-src is derived from NEXT_PUBLIC_SUPABASE_URL in next.config.mjs), so they
# are build ARGs — changing them requires a rebuild. Server-only values
# (SUPABASE_SERVICE_ROLE_KEY, EXTRA_ALLOWED_ORIGINS) are injected at `docker run`
# time and validated at boot by apps/web/instrumentation.ts.

ARG NODE_IMAGE=node:22.13-bookworm-slim

# ── builder: install the workspace (frozen lockfile) and build standalone ──────
FROM ${NODE_IMAGE} AS builder
# Install the pinned pnpm directly (avoids the corepack signature-key bug in the
# bundled corepack: "Cannot find matching keyid"). Keep in sync with packageManager.
RUN npm install -g pnpm@11.0.8
WORKDIR /repo

# Manifests first so the install layer is cached until a manifest/lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY bridge/package.json ./bridge/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# Install only the web subtree (+ its workspace dep @agentroom/shared) — not bridge.
RUN pnpm install --frozen-lockfile --filter web...

# Source, then build the Next.js standalone server.
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# ── runner: minimal non-root runtime from the traced standalone output ─────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next standalone bundles a minimal, traced node_modules + server.js. In a monorepo
# the server entry lands at apps/web/server.js; copy static + public beside it.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

# Liveness: the existing /api/health route returns 200 once the server is up.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
