# Tech Stack — Decisions & Rationale

## Runtime: Node.js 20 LTS

- **Why:** The MCP SDK (`@modelcontextprotocol/sdk`) is a first-class TypeScript
  package. Node 20 provides native ESM, `--watch` mode, and a stable `fetch` API.
- **Minimum version:** Enforced via `"engines": { "node": ">=20" }` in root `package.json`.

---

## Language: TypeScript 5 (strict)

- **Why:** Type safety across shared utilities and tool input schemas. `strict: true`
  surfaces runtime bugs at compile time.
- **Module system:** `"module": "Node16"`, `"moduleResolution": "Node16"` — required
  for correct ESM interop with the MCP SDK and `.js` extensions in imports.
- **Shared config:** All packages extend `shared/tsconfig/base.json` — one source
  of truth for compiler options.

---

## MCP SDK: `@modelcontextprotocol/sdk`

- **Why:** Official SDK for building MCP servers. Handles JSON-RPC 2.0 framing,
  capability negotiation, tool registration, and stdio transport automatically.
- **Transport used:** `StdioServerTransport` — servers communicate over stdin/stdout,
  which is the standard for locally-run MCP servers.

---

## Input Validation: Zod

- **Why:** Runtime validation of tool arguments with automatic TypeScript type inference.
  Tool input types are derived directly from zod schemas — no duplication.
- **Alternative considered:** `joi` — rejected due to weaker TypeScript-first
  type inference.

---

## Monorepo: pnpm Workspaces + Turborepo 2

- **Why pnpm:**
  - Strict hoisting — prevents phantom dependencies
  - `workspace:*` protocol for internal package references
  - Faster installs than npm/yarn for large workspaces
- **Why Turborepo:**
  - Task caching — only rebuilds packages whose inputs changed
  - Parallel task execution across packages
  - `--filter` flag for affected-package-only CI
- **Alternative considered:** Nx — more configuration overhead for this use case.

---

## Versioning: Changesets

- **Why:** Supports independent versioning per package. Each MCP server can be
  bumped at its own pace with an auto-generated `CHANGELOG.md`.
- **Alternative considered:** `lerna` — community has largely moved to changesets.

---

## Containerisation: Docker (multi-stage)

- **Why multi-stage:**
  - `deps` stage installs workspace deps for the target package only
  - `builder` stage compiles TypeScript
  - `runtime` stage copies only `dist/` — no source, no devDeps, no TS compiler
- **Base image:** `node:20-slim` (~30MB vs ~900MB for full debian node image)
- **Build context rule:** Always run `docker build` from the **repo root** so
  monorepo `COPY shared/` paths resolve correctly.

---

## CI/CD: GitHub Actions

- **Why:** Native GitHub integration with matrix builds for parallel Docker image
  builds per MCP server.
- **Turbo in CI:** `--filter=[HEAD^1]` — only rebuilds packages changed in the
  current commit, keeping CI fast as the repo grows.

---

## Adding / Changing a Technology

If you introduce a new technology (new DB driver, new transport, etc.):
1. Document it here with the rationale
2. Update `shared/utils` if it's a shared concern (DB connection, auth client, etc.)
3. Update `.agent/context/integrations.md` if it's an external service
