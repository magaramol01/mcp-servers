# Glossary — Naming Conventions & Abbreviations

## Common Abbreviations

| Abbreviation | Full Form |
|---|---|
| **CI/CD** | Continuous Integration / Continuous Deployment |
| **ESM** | ECMAScript Modules |
| **JSON-RPC** | JSON Remote Procedure Call (MCP transport protocol) |
| **MCP** | Model Context Protocol |
| **NFR** | Non-Functional Requirement |
| **SDK** | Software Development Kit |
| **SIGINT** | Signal Interrupt — triggered by Ctrl+C, used for graceful shutdown |
| **stdio** | Standard Input/Output — the transport MCP servers use |

> Add domain-specific abbreviations to `.agent/wiki/domain.md`.

---

## Naming Conventions

### Packages

| Thing | Convention | Example |
|-------|------------|---------|
| MCP server package name | `@<org>/mcp-<name>` | `@acme/mcp-ticket-tracker` |
| Shared package name | `@<org>/<name>` | `@acme/utils`, `@acme/tsconfig` |
| Package directory | `mcp-<kebab-case>` | `mcp-ticket-tracker` |

### TypeScript

| Thing | Convention | Example |
|-------|------------|---------|
| Variables & functions | `camelCase` | `fetchUser`, `totalCount` |
| Classes & types | `PascalCase` | `McpError`, `UserDocument` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_LIMIT`, `DEFAULT_DB` |
| Files | `camelCase.ts` | `userTools.ts`, `mongoHelper.ts` |
| Zod schemas | `camelCase` + `Schema` | `getUserSchema`, `listItemsSchema` |

### MCP Tools

| Thing | Convention | Example |
|-------|------------|---------|
| Tool name | `snake_case` verb_noun | `get_user_by_id`, `list_open_tickets` |
| Tool description | Sentence case, imperative | `Get a user by their unique ID` |
| Input field names | `camelCase` | `userId`, `statusFilter`, `limit` |

### Git

| Thing | Convention | Example |
|-------|------------|---------|
| Branch name | `<type>/<ticket>-<short-desc>` | `feat/MCP-42-add-search-tool` |
| Commit prefix | Conventional Commits type | `feat`, `fix`, `chore`, `docs` |
| Commit scope | Package name (short) | `(ticket-tracker)`, `(utils)`, `(root)` |

---

## Reserved Field Names

These field names have specific meanings across the codebase:

| Field | Meaning |
|-------|---------|
| `isDeleted` | Soft-delete flag — `true` means logically removed |
| `createdAt` | ISO timestamp when the record was created |
| `updatedAt` | ISO timestamp when the record was last modified |

> Add your own domain-specific reserved field names below.

---

## Tool Verb Reference

Consistent verb usage across all MCP servers:

| Verb | When to use |
|------|-------------|
| `get` | Retrieve one specific record by ID or unique key |
| `list` | Retrieve a collection, optionally filtered |
| `search` | Full-text or multi-field filter |
| `count` | Return a count only — no records |
| `summarise` | Return aggregated/grouped data |
