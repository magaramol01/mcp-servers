# Architecture — MCP Servers Monorepo

## Overview

This monorepo hosts multiple MCP (Model Context Protocol) servers under a single
pnpm workspace + Turborepo setup. Each server in `packages/` is an independently
deployable HTTP service that exposes tools to AI assistants via the
**Streamable HTTP** transport (MCP spec 2025-03-26).

---

## High-Level Service Map

```
┌──────────────────────────────────────────────────────────┐
│                   AI Assistant / MCP Client               │
└───────────────────────────┬──────────────────────────────┘
                            │  Streamable HTTP
                            │  POST/GET/DELETE /mcp
                            │  + SSE stream (server → client)
                            │  + Mcp-Session-Id header
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  packages/      │  │  packages/      │  │  packages/      │
│  mcp-server-1   │  │  mcp-server-2   │  │  mcp-server-n   │
│  :3000/mcp      │  │  :3001/mcp      │  │  :3002/mcp      │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                   │                     │
         └───────────────────┼─────────────────────┘
                             │  shared/utils (logger, env, errors, DB)
                             ▼
               ┌─────────────────────────┐
               │      Data Sources       │
               │   (DB, APIs, etc.)      │
               └─────────────────────────┘
```

---

## Transport: Streamable HTTP

All servers use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.

| HTTP Method | Path | Purpose |
|-------------|------|---------|
| `POST` | `/mcp` | Client sends JSON-RPC; server replies with JSON or opens SSE stream |
| `GET` | `/mcp` | Client opens persistent SSE stream for server-to-client notifications |
| `DELETE` | `/mcp` | Client explicitly terminates the session |

Key headers:
- **`Mcp-Session-Id`** — assigned by server on init; required on all subsequent requests
- **`Last-Event-ID`** — sent by client on reconnect to resume missed SSE events
- **`Origin`** — validated by server to prevent DNS rebinding attacks

---

## Package Dependency Graph

```
shared/tsconfig         (no deps — pure TS config)
        ↑
shared/utils            (depends on: tsconfig + DB drivers)
        ↑
packages/mcp-server-*  (depends on: utils + @modelcontextprotocol/sdk + express + zod)
```

> **Rule:** MCP server packages must never import from each other.
> All shared logic lives in `shared/utils`.

---

## Monorepo Task Pipeline (Turborepo)

```
shared/utils:build
       ↓  (dependsOn: ^build)
packages/*/build        (all MCP servers build in parallel after utils)
```

---

## Shared Utils Responsibilities

```
shared/utils/src/
├── logger.ts     → namespaced structured logger, reads LOG_LEVEL at runtime
├── env.ts        → typed wrappers for process.env (requireEnv, optionalEnv)
├── errors.ts     → base error hierarchy (McpError, ValidationError, etc.)
├── <db>.ts       → singleton DB/client connection with graceful close
└── index.ts      → barrel re-export of all utilities
```

- `logger.ts`, `env.ts`, `errors.ts` — **stateless, pure functions**
- `<db>.ts` — **stateful singleton** (only stateful module in shared/utils)

---

## Each MCP Server Structure

```
packages/<mcp-server-name>/
├── src/
│   └── index.ts         ← Express app, StreamableHTTPServerTransport,
│                           all tool registrations, session management, bootstrap
├── Dockerfile            ← monorepo-aware multi-stage build
├── package.json          ← declares @your-org/mcp-<name>, includes express dep
└── tsconfig.json         ← extends shared/tsconfig/base.json
```

---

## Docker Build Architecture

Each server uses a **3-stage Dockerfile** (always built from repo root):

| Stage | Purpose |
|-------|---------|
| `deps` | Install only the workspace packages this server needs |
| `builder` | Run `turbo build --filter=<this-package>` |
| `runtime` | Copy compiled `dist/` only — minimal final image |

The runtime image starts the Express HTTP server, which listens for MCP
clients over Streamable HTTP on the configured `PORT`.
