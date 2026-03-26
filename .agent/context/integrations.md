# External Integrations

> Document every external system this monorepo's MCP servers connect to.
> Update this file whenever a new integration is added or removed.

---

## Model Context Protocol (MCP)

- **SDK:** `@modelcontextprotocol/sdk`
- **Transport:** `StdioServerTransport` — JSON-RPC 2.0 over stdin/stdout
- **Spec:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Tool discovery:** Client calls `tools/list` → receives all registered tool definitions
- **Tool invocation:** Client calls `tools/call` with `{ name, arguments }`
- **Error handling:** The SDK automatically wraps thrown JS errors into JSON-RPC error objects

### Registering in Claude Desktop

```json
{
  "mcpServers": {
    "<server-alias>": {
      "command": "node",
      "args": ["/absolute/path/to/packages/<server-name>/dist/index.js"],
      "env": {
        "DATABASE_URI": "...",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

Config file location:
- **Linux:** `~/.config/claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node packages/<server-name>/dist/index.js
# Opens http://localhost:5173 — interactive tool explorer
```

---

## Primary Data Source

> Replace this section with your actual data source.

| Field | Value |
|-------|-------|
| **Type** | MongoDB / PostgreSQL / REST API / etc. |
| **Purpose** | [describe what data this source holds] |
| **Access** | Read-only / Read-write |
| **Connection** | Singleton in `shared/utils/src/<db>.ts` |
| **Credential var** | `DATABASE_URI` (see `.agent/context/env.md`) |

---

## Additional Integrations

> Add one entry per external system.

### [Integration Name]

| Field | Value |
|-------|-------|
| **Type** | REST API / gRPC / Message queue / etc. |
| **Purpose** | [what it's used for] |
| **Auth** | API key / OAuth / mTLS / etc. |
| **Env var** | `INTEGRATION_API_KEY` |
| **Base URL** | `INTEGRATION_API_URL` |
| **Used by** | `packages/<server-name>` |

---

## Integration Do's and Don'ts

- ✅ All external clients/connections go through `shared/utils` as singletons
- ✅ All credentials come from env vars via `requireEnv`
- ✅ Document the auth mechanism and env vars for every integration here
- ❌ Never create a new DB/API client per tool call — reuse the singleton
- ❌ Never hardcode base URLs or credentials in source files

---

## Future / Planned Integrations

| Integration | Purpose | Status |
|---|---|---|
| [Name] | [What it would do] | Planned / In progress |
