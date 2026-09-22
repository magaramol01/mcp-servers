# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/tsconfig/package.json ./shared/tsconfig/
COPY shared/utils/package.json ./shared/utils/
COPY packages/mcp-voyage-management/package.json ./packages/mcp-voyage-management/
RUN pnpm install --frozen-lockfile --filter=@mcpkit/mcp-voyage-management...

FROM deps AS builder
COPY shared/ ./shared/
COPY packages/mcp-voyage-management/ ./packages/mcp-voyage-management/
RUN pnpm turbo run build --filter=@mcpkit/mcp-voyage-management

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/shared/utils/dist ./shared/utils/dist
COPY --from=builder /app/shared/utils/package.json ./shared/utils/
COPY --from=builder /app/packages/mcp-voyage-management/dist ./packages/mcp-voyage-management/dist
COPY --from=builder /app/packages/mcp-voyage-management/package.json ./packages/mcp-voyage-management/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

CMD ["node", "packages/mcp-voyage-management/dist/index.js"]
