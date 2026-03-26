# Project: [Your Organization] — MCP Servers Monorepo

> This file is the **entry point for every AI agent session**.
> Read this first, then follow the links below for deeper context.
> Update this file whenever the stack or key rules change.

---

## Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20 LTS |
| **Language** | TypeScript 5 (strict mode) |
| **MCP SDK** | `@modelcontextprotocol/sdk` |
| **Transport** | Streamable HTTP (`StreamableHTTPServerTransport`) |
| **HTTP Server** | Express |
| **Validation** | Zod |
| **Monorepo** | pnpm Workspaces + Turborepo |
| **Versioning** | Changesets |
| **Infra** | Docker (multi-stage builds) |
| **CI/CD** | GitHub Actions |

---

## Repository Layout

```
packages/<mcp-server-name>/    ← Individual, independently deployable MCP servers
shared/utils/                  ← Logger, errors, env helpers, DB connections
shared/tsconfig/               ← Shared TypeScript compiler configuration
```

---

## Key Rules (non-negotiable)

1. **Always `async/await`** — never raw callbacks or `.then()` chains
2. **Always use the env helper** for environment variables — never inline `process.env.KEY`
3. **Never hardcode secrets, URIs, or credentials** anywhere in source
4. **All tool inputs must be validated with `zod`** before use
5. **Shared logic belongs in `shared/utils`** — never cross-import between MCP packages
6. **All errors must use the shared error hierarchy** — never throw raw strings
7. **Log with the shared logger** — never use raw `console.log`
8. **Graceful shutdown** — always close DB connections in the SIGINT handler

---

## Docs Index

| Topic | File |
|-------|------|
| Architecture & service map | [`.agent/spec/architecture.md`](./spec/architecture.md) |
| Requirements & user stories | [`.agent/spec/requirements.md`](./spec/requirements.md) |
| Tool API design patterns | [`.agent/spec/design.md`](./spec/design.md) |
| Domain knowledge | [`.agent/wiki/domain.md`](./wiki/domain.md) |
| Tech stack decisions | [`.agent/wiki/stack.md`](./wiki/stack.md) |
| Glossary & naming conventions | [`.agent/wiki/glossary.md`](./wiki/glossary.md) |
| Code style & formatting | [`.agent/rules/code-style.md`](./rules/code-style.md) |
| Git branching & commits | [`.agent/rules/git.md`](./rules/git.md) |
| Security & secrets handling | [`.agent/rules/security.md`](./rules/security.md) |
| MCP tool API conventions | [`.agent/rules/api.md`](./rules/api.md) |
| Environment variables | [`.agent/context/env.md`](./context/env.md) |
| Infrastructure setup | [`.agent/context/infra.md`](./context/infra.md) |
| External integrations | [`.agent/context/integrations.md`](./context/integrations.md) |
| Active sprint tasks | [`.agent/tasks/active/`](./tasks/active/) |
| Backlog | [`.agent/tasks/backlog/`](./tasks/backlog/) |

---

## Quick Agent Decision Guide

- Adding a new tool → read `.agent/rules/api.md` first
- Touching `shared/utils` → read `.agent/spec/architecture.md`
- Unsure about a term → check `.agent/wiki/glossary.md`
- Writing a commit → follow `.agent/rules/git.md`
- Handling a secret → read `.agent/rules/security.md`
