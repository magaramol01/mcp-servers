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

All servers use **Streamable HTTP** (`StreamableHTTPServerTransport`). The server
runs as a regular HTTP service on a configured port. Clients connect via HTTP.

---

### Method 1 — MCP Inspector (recommended for development)

> **Official docs:** https://modelcontextprotocol.io/docs/tools/inspector

The **MCP Inspector** is an interactive, browser-based developer tool for testing
and debugging MCP servers. It acts as a real MCP client — connecting to your server
over HTTP, discovering tools, and letting you call them with custom inputs.

#### Installation & Launch

No global install needed — run it with `npx`:

```bash
# Connect to a running Streamable HTTP server
npx @modelcontextprotocol/inspector http://localhost:3000/mcp

# You can also pass env vars and args when connecting to a local subprocess server
npx @modelcontextprotocol/inspector <command> <arg1> <arg2>
```

#### Full Workflow

```bash
# Step 1 — Build the server
pnpm turbo run build --filter=@your-org/mcp-<name>

# Step 2 — Set env vars and start the HTTP server
PORT=3000 DATABASE_URI=<your-uri> node packages/mcp-<name>/dist/index.js

# Step 3 — In a second terminal, launch the Inspector
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
# → Browser opens at http://localhost:5173
```

#### Inspector UI — Feature Overview

##### Server Connection Pane (left sidebar)
- Select the **transport type** (Streamable HTTP for our servers)
- Enter the server URL (`http://localhost:3000/mcp`)
- Shows current connection status and protocol version negotiated

##### Tools Tab ⭐ (most used)
- Lists **all registered tools** with names and descriptions
- Shows the **full JSON schema** of every input field
- Lets you **fill in arguments** and execute the tool
- Displays the **raw tool result** exactly as the LLM would receive it
- Highlights validation errors if you pass wrong input types

##### Resources Tab
- Lists any static resources your server exposes (file previews, DB schemas, etc.)
- Shows resource metadata: MIME type and description
- Allows reading resource content directly
- Supports subscription testing for live resources

##### Prompts Tab
- Displays available prompt templates if your server defines them
- Shows each prompt's arguments and descriptions
- Lets you preview the full generated message with custom argument values

##### Notifications Pane (bottom)
- Shows **all raw JSON-RPC messages** in both directions (request + response)
- Displays server log messages and notifications in real time
- Essential for debugging session errors, malformed responses, or unexpected tool failures

---

#### Development Workflow with Inspector

```
1. Start Development
   ├── Launch Inspector pointing at your server URL
   ├── Verify the connection succeeds (session ID issued)
   └── Check "capabilities" in the connection pane — tools should appear

2. Iterative Testing
   ├── Edit your tool handler code
   ├── Rebuild: pnpm turbo run build --filter=@your-org/mcp-<name>
   ├── Restart the server
   ├── Click "Reconnect" in the Inspector (no browser refresh needed)
   └── Re-test the affected tool

3. Test Edge Cases
   ├── Pass invalid input types → verify your zod schema rejects them
   ├── Omit required fields → confirm correct error response
   ├── Pass boundary values (limit=0, limit=101) → check clamping
   └── Simulate concurrent calls → watch the Notifications pane for ordering
```

#### What to Check Before Shipping a Tool

| Check | How to verify in Inspector |
|-------|---------------------------|
| Tool appears with correct name | Tools tab → see the list |
| Description is clear and specific | Tools tab → hover the tool name |
| All input fields have descriptions | Tools tab → expand the schema |
| Valid input returns correct JSON | Execute with good data, inspect result |
| Invalid input returns JSON-RPC error | Execute with bad data, check Notifications pane |
| Empty results return `[]` not `null` | Filter for no matches, check result |
| Result is pretty-printed JSON | Inspect `content[0].text` in the response |

---

### Method 2 — curl (quick sanity check)

Streamable HTTP is standard HTTP, so you can test with `curl`:

```bash
# Step 1: Initialize a session (returns Mcp-Session-Id in response body or header)
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'

# Step 2: List available tools
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <id-from-step-1>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Step 3: Call a specific tool
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <id-from-step-1>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"your_tool_name","arguments":{"key":"value"}}}'

# Step 4: Terminate session
curl -X DELETE http://localhost:3000/mcp \
  -H "Mcp-Session-Id: <id-from-step-1>"
```

---

### Method 3 — Register in Claude Desktop (end-to-end)

HTTP-based MCP servers use the `url` key (not `command`) in Claude Desktop config:

Edit `~/.config/claude/claude_desktop_config.json` (Linux) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "<server-alias>": {
      "url": "http://localhost:3000/mcp"
    },
    "<another-server>": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

> Each server must be **already running** before starting Claude Desktop.
> Servers appear under the 🔌 icon in the chat interface.

---

### Method 4 — Vitest unit tests (business logic only)

For pure business logic (helpers, transformations), extract tool handlers
to separate files and unit-test them independently of the HTTP layer:

```
packages/<server-name>/
└── src/
    ├── index.ts               ← Express server + tool registrations
    ├── tools/
    │   └── getItem.ts         ← extract handler logic here
    └── tools/__tests__/
        └── getItem.test.ts    ← unit test the handler in isolation
```

```bash
# Add vitest to the package
pnpm add -D vitest --filter=@your-org/mcp-<name>

# Add to that package's package.json scripts:
# "test": "vitest run"

# Run tests across all packages via turbo
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
