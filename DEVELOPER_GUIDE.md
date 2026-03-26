# Fleet Orion — MCP Servers Developer Guide

> A complete reference for setting up, testing, and contributing to the
> `@fleet-orion/mcp-servers` monorepo.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Setup](#2-initial-setup)
3. [Project Structure Explained](#3-project-structure-explained)
4. [Environment Configuration](#4-environment-configuration)
5. [Running Servers Locally](#5-running-servers-locally)
6. [Testing Your MCP Server](#6-testing-your-mcp-server)
7. [Adding a New MCP Server](#7-adding-a-new-mcp-server)
8. [Working with Shared Utils](#8-working-with-shared-utils)
9. [Build System & Turborepo](#9-build-system--turborepo)
10. [Docker Workflow](#10-docker-workflow)
11. [Versioning & Changesets](#11-versioning--changesets)
12. [CI/CD Pipeline](#12-cicd-pipeline)
13. [Best Practices](#13-best-practices)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

Make sure the following are installed before you begin:

| Tool | Min Version | Install |
|------|-------------|---------|
| **Node.js** | 20.x LTS | [nodejs.org](https://nodejs.org) |
| **pnpm** | 9.x | `corepack enable pnpm` |
| **Docker** | 24.x | [docs.docker.com](https://docs.docker.com/get-docker/) |
| **Git** | 2.x | system package manager |
| **MongoDB** | 6.x (local) | Docker or Atlas |

> **Tip:** Use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions.
> The repo's `engines` field in `package.json` enforces minimum versions.

### Enable corepack (one-time)

```bash
corepack enable pnpm
```

This ensures pnpm is sourced from the exact version pinned in `packageManager`
inside `package.json`, giving every developer the same pnpm version.

---

## 2. Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/mcp-servers.git
cd mcp-servers

# 2. Install all workspace dependencies (hoisted via pnpm)
pnpm install

# 3. Build the shared utils first (other packages depend on it)
pnpm turbo run build --filter=@fleet-orion/utils

# 4. Build everything
pnpm build
```

After `pnpm install`, all `dist/` outputs for shared packages need to exist
before the MCP server packages can compile. The Turborepo `dependsOn: ["^build"]`
directive handles this automatically when you run `pnpm build`.

---

## 3. Project Structure Explained

```
mcp-servers/
│
├── packages/                        ← Individual MCP servers (deployable units)
│   ├── mcp-vessel-tracker/
│   │   ├── src/index.ts             ← Server entry point
│   │   ├── Dockerfile               ← Monorepo-aware multi-stage build
│   │   ├── package.json
│   │   └── tsconfig.json            ← Extends shared/tsconfig/base.json
│   ├── mcp-port-analytics/
│   └── mcp-alerts-service/
│
├── shared/
│   ├── tsconfig/
│   │   └── base.json                ← Single source of TS compiler options
│   └── utils/
│       └── src/
│           ├── index.ts             ← Re-exports everything (barrel file)
│           ├── logger.ts            ← Namespaced logger, respects LOG_LEVEL
│           ├── errors.ts            ← McpError, ValidationError, NotFoundError
│           ├── env.ts               ← requireEnv / optionalEnv helpers
│           └── mongodb.ts           ← Singleton MongoDB connection
│
├── .changeset/                      ← Versioning metadata (auto-generated)
├── .github/
│   ├── CODEOWNERS                   ← Auto-assigns PR reviewers per package
│   └── workflows/ci.yml             ← GitHub Actions pipeline
│
├── pnpm-workspace.yaml              ← Declares workspace packages
├── turbo.json                       ← Task pipeline & caching rules
└── package.json                     ← Root scripts & dev dependencies
```

### Dependency flow

```
shared/tsconfig   ←── (extends)  ───  all packages
shared/utils      ←── (imports)  ───  all MCP servers
```

**Never import one MCP server package from another.** Shared logic always
goes into `shared/utils`.

---

## 4. Environment Configuration

Each MCP server reads configuration from environment variables at **runtime**.
No `.env` files are committed — copy the root example:

```bash
cp .env.example packages/mcp-vessel-tracker/.env
cp .env.example packages/mcp-port-analytics/.env
cp .env.example packages/mcp-alerts-service/.env
```

### Available variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | ✅ Yes | — | Full MongoDB connection string |
| `DB_NAME` | ❌ No | `fo-shore` | Target database name |
| `LOG_LEVEL` | ❌ No | `info` | `debug` / `info` / `warn` / `error` |

### Example `.env` for local development

```dotenv
MONGO_URI=mongodb://localhost:27017
DB_NAME=fo-shore
LOG_LEVEL=debug
```

> **Security rule:** Never commit `.env` files. The root `.gitignore` already
> excludes `*.env` and `.env.*`. Only `.env.example` (no secrets) is committed.

### Using `requireEnv` in code

```typescript
import { requireEnv, optionalEnv } from "@fleet-orion/utils";

// Throws immediately at startup if missing — fail fast
const uri = requireEnv("MONGO_URI");

// Returns a safe default if not set
const db  = optionalEnv("DB_NAME", "fo-shore");
```

This guarantees configuration errors surface at startup, not mid-request.

---

## 5. Running Servers Locally

### Run a single server in watch mode

```bash
pnpm turbo run dev --filter=@fleet-orion/mcp-vessel-tracker
```

This starts `tsc --watch` and restarts `node` on file changes via
`node --watch`.

### Run all servers concurrently

```bash
pnpm dev
```

Turborepo will run the `dev` task across all packages in parallel.

### Run a built server directly

```bash
# Build first
pnpm turbo run build --filter=@fleet-orion/mcp-vessel-tracker

# Run the compiled output
MONGO_URI=mongodb://localhost:27017 node packages/mcp-vessel-tracker/dist/index.js
```

---

## 6. Testing Your MCP Server

MCP servers communicate over **stdio** (stdin/stdout JSON-RPC). Testing them
requires either a proper MCP client or direct JSON-RPC calls.

### Method 1 — MCP Inspector (recommended for development)

The official MCP Inspector is the fastest way to interactively test tools.

```bash
# Install globally (one-time)
npm install -g @modelcontextprotocol/inspector

# Run against a built server
MONGO_URI=mongodb://localhost:27017 \
  npx @modelcontextprotocol/inspector \
  node packages/mcp-vessel-tracker/dist/index.js
```

Open `http://localhost:5173` in your browser. You'll see all registered tools,
can call them with custom inputs, and inspect raw JSON-RPC responses.

### Method 2 — Raw stdin JSON-RPC (quick sanity check)

MCP uses JSON-RPC 2.0 over stdio. You can pipe requests directly:

```bash
# Build the server first
pnpm turbo run build --filter=@fleet-orion/mcp-vessel-tracker

# Send a tools/list request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  MONGO_URI=mongodb://localhost:27017 \
  node packages/mcp-vessel-tracker/dist/index.js
```

Expected response shape:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "get_vessel_position", "description": "...", "inputSchema": { ... } },
      { "name": "list_active_vessels", "description": "...", "inputSchema": { ... } }
    ]
  }
}
```

Call a specific tool:
```bash
echo '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "list_active_vessels",
    "arguments": {}
  }
}' | MONGO_URI=mongodb://localhost:27017 \
     node packages/mcp-vessel-tracker/dist/index.js
```

### Method 3 — Register in Claude Desktop (end-to-end testing)

Edit `~/.config/claude/claude_desktop_config.json` (Linux) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "vessel-tracker": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-servers/packages/mcp-vessel-tracker/dist/index.js"
      ],
      "env": {
        "MONGO_URI": "mongodb://localhost:27017",
        "DB_NAME": "fo-shore",
        "LOG_LEVEL": "debug"
      }
    },
    "port-analytics": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-servers/packages/mcp-port-analytics/dist/index.js"
      ],
      "env": {
        "MONGO_URI": "mongodb://localhost:27017",
        "DB_NAME": "fo-shore"
      }
    },
    "alerts-service": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-servers/packages/mcp-alerts-service/dist/index.js"
      ],
      "env": {
        "MONGO_URI": "mongodb://localhost:27017",
        "DB_NAME": "fo-shore"
      }
    }
  }
}
```

Restart Claude Desktop. Your tools will appear automatically in the chat
interface under the 🔌 icon.

### Method 4 — TypeScript unit tests (jest / vitest)

For pure business logic (helpers, transformations), write unit tests in the
same package:

```
packages/mcp-vessel-tracker/
└── src/
    ├── index.ts
    ├── tools/
    │   └── getVesselPosition.ts    ← extract tool logic here
    └── tools/__tests__/
        └── getVesselPosition.test.ts
```

Add vitest to the package:

```bash
pnpm add -D vitest --filter=@fleet-orion/mcp-vessel-tracker
```

Add a `test` script to that package's `package.json`:

```json
"scripts": {
  "test": "vitest run"
}
```

Add `"test"` to `turbo.json` tasks:

```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

Run tests across all packages:

```bash
pnpm turbo run test
```

---

## 7. Adding a New MCP Server

### Step-by-step

```bash
# 1. Copy the vessel-tracker as a template
cp -r packages/mcp-vessel-tracker packages/mcp-new-service

# 2. Update the name in packages/mcp-new-service/package.json
#    Change: "@fleet-orion/mcp-vessel-tracker" → "@fleet-orion/mcp-new-service"

# 3. Re-install to register the new workspace package
pnpm install

# 4. Replace src/index.ts with your tools
# 5. Build and verify
pnpm turbo run build --filter=@fleet-orion/mcp-new-service
```

### Checklist for a new server

- [ ] `package.json` name set to `@fleet-orion/mcp-<name>`
- [ ] `tsconfig.json` extends `@fleet-orion/tsconfig/base.json`
- [ ] `src/index.ts` registers server with `McpServer` from `@modelcontextprotocol/sdk`
- [ ] All tools validated with `zod` schemas
- [ ] `MONGO_URI` read via `requireEnv` (not hardcoded)
- [ ] Graceful shutdown on `SIGINT` calling `disconnectMongo()`
- [ ] `Dockerfile` updated for the new package name
- [ ] Entry added to `.github/CODEOWNERS`
- [ ] Entry added to `.github/workflows/ci.yml` Docker matrix

---

## 8. Working with Shared Utils

The `@fleet-orion/utils` package is the **single source of truth** for:

| Export | Purpose |
|--------|---------|
| `createLogger(namespace)` | Returns a scoped logger |
| `requireEnv(key)` | Throws if env var missing |
| `optionalEnv(key, default)` | Returns default if missing |
| `requireEnvInt(key)` | Parses env as integer |
| `requireEnvBool(key)` | Parses env as boolean |
| `connectMongo(uri, db)` | Singleton MongoDB client |
| `disconnectMongo()` | Closes connection gracefully |
| `McpError` | Base error class |
| `ValidationError` | Input validation failures |
| `NotFoundError` | Resource not found |
| `UnauthorizedError` | Auth failures |
| `toError(unknown)` | Normalises caught values to Error |

### Adding a new utility

1. Create `shared/utils/src/your-helper.ts`
2. Export it from `shared/utils/src/index.ts`
3. Rebuild utils: `pnpm turbo run build --filter=@fleet-orion/utils`
4. Import in any MCP server via `@fleet-orion/utils`

> **Rule:** Shared utils must have **zero side effects** on import.
> They should be pure functions or lazy-initialized (like the MongoDB singleton).

---

## 9. Build System & Turborepo

### Task pipeline

```
shared/utils:build
       ↓  (dependsOn: ^build)
mcp-vessel-tracker:build
mcp-port-analytics:build
mcp-alerts-service:build
```

Turborepo automatically parallelises independent tasks and caches outputs.

### Useful filter patterns

```bash
# Build only one package
pnpm turbo run build --filter=@fleet-orion/mcp-vessel-tracker

# Build a package AND its dependencies
pnpm turbo run build --filter=@fleet-orion/mcp-vessel-tracker...

# Build only packages changed since last commit (great for CI)
pnpm turbo run build --filter=[HEAD^1]

# Build only packages changed on a branch vs main
pnpm turbo run build --filter=[origin/main...HEAD]
```

### Cache behaviour

- Build outputs in `dist/` are cached by Turborepo
- If inputs haven't changed, subsequent `pnpm build` takes **< 1s**
- Cache lives in `.turbo/` (gitignored locally)
- Remote caching can be enabled via [Turbo Remote Cache](https://turbo.build/repo/docs/core-concepts/remote-caching)

### Clearing cache

```bash
# Clear turbo cache only
pnpm turbo run clean

# Full nuclear reset
pnpm clean && pnpm install && pnpm build
```

---

## 10. Docker Workflow

Each MCP server has its own `Dockerfile` with a **3-stage build**:

| Stage | Purpose |
|-------|---------|
| `deps` | Installs only the required workspace packages |
| `builder` | Compiles TypeScript via Turbo |
| `runtime` | Copies only compiled `dist/` — minimal final image |

### Build a single image locally

```bash
# From the REPO ROOT (context must be root for monorepo COPY paths to work)
docker build \
  -f packages/mcp-vessel-tracker/Dockerfile \
  -t fleet-orion/mcp-vessel-tracker:dev \
  .
```

### Run the container

```bash
docker run --rm \
  -e MONGO_URI="mongodb://host.docker.internal:27017" \
  -e DB_NAME="fo-shore" \
  -e LOG_LEVEL="debug" \
  fleet-orion/mcp-vessel-tracker:dev
```

> Use `host.docker.internal` (Docker Desktop) or `172.17.0.1` (Linux) to
> reach a MongoDB instance running on your host machine.

### Docker Compose (local stack)

Create a `docker-compose.yml` at the repo root for spinning up all servers
alongside MongoDB:

```yaml
services:
  mongo:
    image: mongo:6
    ports:
      - "27017:27017"

  mcp-vessel-tracker:
    build:
      context: .
      dockerfile: packages/mcp-vessel-tracker/Dockerfile
    environment:
      MONGO_URI: mongodb://mongo:27017
      DB_NAME: fo-shore
    depends_on: [mongo]

  mcp-port-analytics:
    build:
      context: .
      dockerfile: packages/mcp-port-analytics/Dockerfile
    environment:
      MONGO_URI: mongodb://mongo:27017
      DB_NAME: fo-shore
    depends_on: [mongo]

  mcp-alerts-service:
    build:
      context: .
      dockerfile: packages/mcp-alerts-service/Dockerfile
    environment:
      MONGO_URI: mongodb://mongo:27017
      DB_NAME: fo-shore
    depends_on: [mongo]
```

```bash
docker compose up --build
```

---

## 11. Versioning & Changesets

This monorepo uses [Changesets](https://github.com/changesets/changesets)
for **independent versioning** of each package.

### Workflow for making a release

```bash
# 1. Make your code changes and commit

# 2. Create a changeset (answers: which packages changed? patch/minor/major?)
pnpm changeset

# 3. Commit the generated .changeset/*.md file with your PR

# 4. When merging to main, bump versions
pnpm changeset version

# 5. Commit the version bumps, then publish (if using a registry)
pnpm changeset publish
```

### Changeset types

| Type | When to use | Example |
|------|-------------|---------|
| `patch` | Bug fix, no API change | Fix a MongoDB query |
| `minor` | New tool added, backwards compatible | Add `get_vessel_route` tool |
| `major` | Breaking change | Rename or remove a tool |

> If you change **only** `shared/utils`, you still need a changeset for it.
> Changesets will automatically bump dependents.

---

## 12. CI/CD Pipeline

The `.github/workflows/ci.yml` pipeline runs on every push and PR.

### What runs on PRs

1. **Type check** — `turbo typecheck --filter=[HEAD^1]` (affected packages only)
2. **Build** — `turbo build --filter=[HEAD^1]` (affected packages only)

Turborepo's `--filter=[HEAD^1]` means only packages with changed files are
rebuilt. A change to `mcp-vessel-tracker` will **not** rebuild the other two.

### What runs on `main` merge

3. **Docker build matrix** — builds all 3 server images in parallel using
   GitHub Actions build cache (`cache-from: type=gha`)

### Adding secrets to GitHub Actions

Per-package secrets (e.g., different MONGO_URI per environment) can be scoped
using path-based conditions:

```yaml
- name: Set MONGO_URI
  run: echo "MONGO_URI=${{ secrets.PROD_MONGO_URI }}" >> $GITHUB_ENV
  if: matrix.package == 'mcp-vessel-tracker'
```

---

## 13. Best Practices

### Code

- ✅ **Use `zod` for all tool input validation** — never trust raw arguments
- ✅ **Use `requireEnv` at the top of every tool** — fail fast, not mid-request
- ✅ **Always handle errors with `toError(err)`** — never `throw err` on an unknown
- ✅ **Use `createLogger(namespace)`** — never use raw `console.log`
- ✅ **Call `disconnectMongo()` in SIGINT handler** — clean shutdown always
- ❌ **Never hardcode connection strings or secrets**
- ❌ **Never `import` one MCP package from another** — use `shared/utils`
- ❌ **Never use `any` in TypeScript** — `strict: true` is enforced

### Git

- ✅ One commit per logical change
- ✅ Reference Jira/GitHub issue in commit message: `feat(vessel-tracker): add speed alert tool [FO-123]`
- ✅ Always open a PR — no direct pushes to `main`
- ✅ Wait for CI green before merging
- ✅ Add a changeset to your PR if the change is in a `packages/` or `shared/` directory

### Tools design (MCP-specific)

- ✅ **Tool names** — use `snake_case` verbs: `get_`, `list_`, `create_`, `update_`
- ✅ **Descriptions** — write for the LLM, be specific about what the tool returns
- ✅ **Return JSON strings** — always `JSON.stringify(result, null, 2)` in `content[0].text`
- ✅ **Keep tools focused** — one tool = one clear action
- ✅ **Add `.describe()` to every zod field** — the LLM reads these as hints
- ❌ **Don't mutate data** in read-oriented servers — MCP tools should be idempotent where possible

### MongoDB

- ✅ Always project only needed fields (`.project({ name: 1, imo: 1 })`)
- ✅ Filter soft-deleted records: `{ isDeleted: { $ne: true } }`
- ✅ Always add a `limit()` to unbounded queries
- ✅ Reuse the singleton from `connectMongo()` — never create multiple clients
- ❌ Never do aggregations without a `$match` stage first

---

## 14. Troubleshooting

### `Cannot find module '@fleet-orion/utils'`

The shared package hasn't been built yet. Run:
```bash
pnpm turbo run build --filter=@fleet-orion/utils
```

### `process is not defined` / `console is not defined` in shared utils

Ensure `shared/utils/tsconfig.json` has:
```json
"compilerOptions": {
  "types": ["node"]
}
```

### `pnpm install` fails with workspace resolution errors

Make sure `pnpm-workspace.yaml` correctly lists all package globs:
```yaml
packages:
  - "packages/*"
  - "shared/*"
```

Then run `pnpm install` again from the repo root.

### MCP server exits immediately with no output

Check that `MONGO_URI` is set. If `requireEnv` throws, the process exits
before the stdio transport attaches. Run with:
```bash
MONGO_URI=mongodb://localhost:27017 node dist/index.js
```

### Turbo not detecting changes in CI

Make sure `fetch-depth: 2` is set in the GitHub Actions checkout step so
`HEAD^1` resolution works:
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 2
```

### Docker build fails with `COPY` path not found

Always build from the **repo root**, not from inside the package directory:
```bash
# ✅ Correct
docker build -f packages/mcp-vessel-tracker/Dockerfile .

# ❌ Wrong — COPY paths won't resolve
cd packages/mcp-vessel-tracker && docker build .
```

---

*Last updated: March 2026 | Maintained by the Fleet Orion Platform Team*
