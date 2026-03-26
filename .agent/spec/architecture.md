# Architecture — MCP Servers Monorepo

## Overview

This monorepo hosts multiple MCP (Model Context Protocol) servers under a single
pnpm workspace + Turborepo setup. Each server in `packages/` is an independently
deployable unit that exposes tools to AI assistants via stdio JSON-RPC.

---

## High-Level Service Map

```
┌─────────────────────────────────────────────────────────┐
│                   AI Assistant / MCP Client              │
└──────────────────────────┬──────────────────────────────┘
                           │  MCP / stdio JSON-RPC
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  packages/   │  │  packages/   │  │  packages/   │
│  mcp-server-1│  │  mcp-server-2│  │  mcp-server-n│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │  shared/utils (logger, env, db, errors)
                         ▼
              ┌─────────────────────┐
              │   Data Sources      │
              │  (DB, APIs, etc.)   │
              └─────────────────────┘
```

---

## Package Dependency Graph

```
shared/tsconfig         (no deps — pure TS config)
        ↑
shared/utils            (depends on: tsconfig + any DB drivers)
        ↑
packages/mcp-server-*  (depends on: utils + @modelcontextprotocol/sdk + zod)
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
│   └── index.ts         ← registers McpServer, all tools, bootstrap + SIGINT
├── Dockerfile            ← monorepo-aware multi-stage build
├── package.json          ← declares @your-org/mcp-<name>
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
