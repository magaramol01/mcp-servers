# External Integrations

> Document every external system this monorepo's MCP servers connect to.
> Update this file whenever a new integration is added or removed.

---

## Model Context Protocol (MCP)

- **SDK:** `@modelcontextprotocol/sdk`
- **Transport:** `StreamableHTTPServerTransport` — MCP spec 2025-03-26
- **Spec:** [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Endpoint:** Single `/mcp` endpoint handles all communication:
  - `POST /mcp` — client sends JSON-RPC; server replies via JSON or SSE stream
  - `GET /mcp` — client opens persistent SSE stream for server notifications
  - `DELETE /mcp` — client terminates the session
- **Session tracking:** `Mcp-Session-Id` header (UUID, assigned on init)
- **Resumability:** `Last-Event-ID` header allows clients to reconnect and replay missed events

### Registering in Claude Desktop

```json
{
  "mcpServers": {
    "<server-alias>": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Config file location:
- **Linux:** `~/.config/claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

> Note: Claude Desktop uses the `url` key (not `command`) for HTTP-based MCP servers.

### Testing with MCP Inspector

```bash
# Start the server
PORT=3000 node packages/<server-name>/dist/index.js

# Connect Inspector over HTTP
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
# Opens http://localhost:5173
```

### Testing with curl

```bash
# Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'

# List tools (add Mcp-Session-Id from the response above)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
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
