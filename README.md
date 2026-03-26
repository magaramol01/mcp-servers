# Fleet Orion — MCP Servers Monorepo

> pnpm Workspaces + Turborepo monorepo hosting all @mcpkit MCP servers.

## Repository Structure

```
mcp-servers/
├── packages/
│   ├── mcp-vessel-tracker/     ← Vessel position & fleet listing
│   ├── mcp-port-analytics/     ← Report summaries & overdue tracking
│   └── mcp-alerts-service/     ← Notifications & reopen requests
├── shared/
│   ├── utils/                  ← Logger, errors, env helpers, MongoDB singleton
│   └── tsconfig/               ← Shared TypeScript base config
├── .github/
│   ├── workflows/ci.yml        ← Turbo affected CI + Docker matrix
│   └── CODEOWNERS              ← Per-package code ownership
├── .changeset/                 ← Independent versioning
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Quick Start

```bash
# 1. Install all packages
pnpm install

# 2. Build everything
pnpm build

# 3. Build only one server
pnpm turbo run build --filter=@mcpkit/mcp-vessel-tracker

# 4. Dev mode (watch) for one server
pnpm turbo run dev --filter=@mcpkit/mcp-vessel-tracker
```

## Environment Variables

Copy `.env.example` to `.env` in each package directory:

```bash
cp .env.example packages/mcp-vessel-tracker/.env
```

| Variable    | Required | Default    | Description                  |
|-------------|----------|------------|------------------------------|
| `MONGO_URI` | ✅       | —          | MongoDB connection string     |
| `DB_NAME`   | ❌       | `fo-shore` | Database name                |
| `LOG_LEVEL` | ❌       | `info`     | debug / info / warn / error  |

## Adding a New MCP Server

```bash
# 1. Copy the template
cp -r packages/mcp-vessel-tracker packages/mcp-new-server

# 2. Update name in packages/mcp-new-server/package.json
# 3. Re-install to register the workspace package
pnpm install

# 4. Build
pnpm turbo run build --filter=@mcpkit/mcp-new-server
```

## Versioning & Releases

```bash
# Create a changeset
pnpm changeset

# Bump versions
pnpm changeset version

# Publish (if using a registry)
pnpm changeset publish
```

## CI/CD

- **Pull Requests**: Turbo builds only the affected packages (`--filter=[HEAD^1]`)
- **Main branch**: Docker images built per-package via matrix strategy
- **Each Dockerfile** is monorepo-aware with multi-stage builds for minimal image size
