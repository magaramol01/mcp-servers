# Fleet Orion — MCP Servers Monorepo

> pnpm Workspaces + Turborepo monorepo hosting all @mcpkit MCP servers.

## Repository Structure

```
mcp-servers/
├── packages/
│   ├── mcp-vessel-tracker/     ← Vessel position & fleet listing
│   ├── mcp-port-analytics/     ← Report summaries & overdue tracking
│   ├── mcp-alerts-service/     ← Per-tenant alert executions & rules
│   └── mcp-technical-advisory/ ← PDF technical advisory RAG over GCS + PageIndex
├── shared/
│   ├── utils/                  ← Logger, errors, env helpers, MongoDB/PostgreSQL clients
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

| Variable | Used by | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `MONGO_URI` | `mcp-vessel-tracker`, `mcp-port-analytics` | ✅ | — | MongoDB connection string |
| `DB_NAME` | `mcp-vessel-tracker`, `mcp-port-analytics` | ❌ | `fo-shore` | MongoDB database name |
| `EMISSION_ENGINEER_POSTGRES_URL` | `mcp-emission-engineer` | ✅ | — | Base PostgreSQL URL for emission workflows |
| `ALERTS_SERVICE_POSTGRES_URL` | `mcp-alerts-service` | ✅ | — | Base PostgreSQL URL; each tool swaps the database path with the requested `tenant` |
| `PAGEINDEX_API_KEY` | `mcp-technical-advisory` | ✅ | — | API key for PageIndex document indexing and chat |
| `GCS_BUCKET_NAME` | `mcp-technical-advisory` | ✅ | — | Google Cloud Storage bucket containing PDF source documents |
| `TECHNICAL_ADVISORY_GCS_PREFIX` | `mcp-technical-advisory` | ❌ | — | Optional default GCS object prefix used by `index_all_pdfs` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `mcp-technical-advisory` | ⚠️ Usually | — | Absolute path to the GCP service account JSON file for local/self-hosted deployments |
| `GEMINI_API_KEY` | `mcp-technical-advisory` | ❌ | — | Optional fallback key if required by the PageIndex account configuration |
| `TECHNICAL_ADVISORY_HOST` | `mcp-technical-advisory` | ❌ | `0.0.0.0` | Host interface for the HTTP MCP server |
| `TECHNICAL_ADVISORY_PORT` | `mcp-technical-advisory` | ❌ | `3000` | Port for the HTTP MCP server |
| `LOG_LEVEL` | all services | ❌ | `info` | `debug` / `info` / `warn` / `error` |

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
