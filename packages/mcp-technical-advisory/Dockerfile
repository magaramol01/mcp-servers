# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/tsconfig/package.json ./shared/tsconfig/
COPY shared/utils/package.json ./shared/utils/
COPY packages/mcp-technical-advisory/package.json ./packages/mcp-technical-advisory/
RUN pnpm install --frozen-lockfile --filter=@mcpkit/mcp-technical-advisory...

FROM deps AS builder
COPY shared/ ./shared/
COPY packages/mcp-technical-advisory/ ./packages/mcp-technical-advisory/
RUN pnpm turbo run build --filter=@mcpkit/mcp-technical-advisory

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000

COPY --from=builder /app/shared/utils/dist ./shared/utils/dist
COPY --from=builder /app/shared/utils/package.json ./shared/utils/
COPY --from=builder /app/packages/mcp-technical-advisory/dist ./packages/mcp-technical-advisory/dist
COPY --from=builder /app/packages/mcp-technical-advisory/package.json ./packages/mcp-technical-advisory/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

CMD ["node", "packages/mcp-technical-advisory/dist/index.js"]
