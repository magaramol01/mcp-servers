# Requirements — MCP Servers Monorepo

> Fill this file with your organization's actual product requirements.
> The sections below are a recommended structure — update them as your product evolves.

---

## Purpose

<!-- Describe what this collection of MCP servers is for.
     What problem does it solve? Who are the users? -->

Expose [your organization]'s internal data and services to AI assistants
(Claude, Gemini, Copilot, etc.) via the Model Context Protocol, enabling
users to interact with business data through natural language.

---

## User Stories

### Template — fill in per MCP server

- As a **[role]**, I want to [ask / do something] so that [business outcome].

### Example format

- As a **data analyst**, I want to ask "what are this week's top metrics?"
  so I can get a summary without writing SQL.
- As a **support engineer**, I want to list open tickets by priority
  so I can triage without opening the dashboard.

---

## Business Rules

> Document rules that apply across all MCP servers.

1. **Read-only by default** — MCP servers should be read-only unless write
   access is explicitly required and reviewed.
2. **Soft deletes** — If your data uses soft-delete flags, always filter them
   out in queries unless explicitly fetching deleted records.
3. **Result limits** — All list tools must cap results to prevent overwhelming
   the LLM context window (recommended: default 20, max 100).
4. **Data freshness** — Document whether tools return live or cached data.
5. **Authorisation** — Document the trust model: is the MCP server trusted
   server-side, or does it need per-user auth?

---

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Startup time | < 2 seconds |
| Tool response time | < 500ms for simple queries |
| DB connection | Singleton — one client per process |
| Graceful shutdown | Close connections on SIGINT within 2s |
| Docker image size | < 200MB per server |

---

## Per-Server Requirements

> Add a subsection per MCP server as you build them.

### `packages/<server-name>`

- **Purpose:** [what this server does]
- **Data source:** [which DB / API it connects to]
- **Tools:** [list of tools it exposes]
- **Users:** [who uses this server]
