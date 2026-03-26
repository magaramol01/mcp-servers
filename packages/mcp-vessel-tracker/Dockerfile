# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable pnpm

# ─── Dependency Stage ─────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/tsconfig/package.json ./shared/tsconfig/
COPY shared/utils/package.json ./shared/utils/
COPY packages/mcp-vessel-tracker/package.json ./packages/mcp-vessel-tracker/
RUN pnpm install --frozen-lockfile --filter=@fleet-orion/mcp-vessel-tracker...

# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM deps AS builder
COPY shared/ ./shared/
COPY packages/mcp-vessel-tracker/ ./packages/mcp-vessel-tracker/
RUN pnpm turbo run build --filter=@fleet-orion/mcp-vessel-tracker

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/shared/utils/dist ./shared/utils/dist
COPY --from=builder /app/shared/utils/package.json ./shared/utils/
COPY --from=builder /app/packages/mcp-vessel-tracker/dist ./packages/mcp-vessel-tracker/dist
COPY --from=builder /app/packages/mcp-vessel-tracker/package.json ./packages/mcp-vessel-tracker/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

CMD ["node", "packages/mcp-vessel-tracker/dist/index.js"]
