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

## Primary Data Sources

### MongoDB

| Field | Value |
|-------|-------|
| **Type** | MongoDB |
| **Purpose** | Vessel positions, fleet listings, and report analytics |
| **Access** | Read-only from MCP tools |
| **Connection** | Singleton in `shared/utils/src/mongodb.ts` |
| **Credential var** | `MONGO_URI` |
| **Used by** | `packages/mcp-vessel-tracker`, `packages/mcp-port-analytics` |

### PostgreSQL

| Field | Value |
|-------|-------|
| **Type** | PostgreSQL |
| **Purpose** | Alert execution data and emission engineering workflows |
| **Access** | Read-only from MCP tools |
| **Connection** | Singleton in `shared/utils/src/postgres.ts` |
| **Credential var** | `EMISSION_ENGINEER_POSTGRES_URL`, `ALERTS_SERVICE_POSTGRES_URL` |
| **Used by** | `packages/mcp-emission-engineer`, `packages/mcp-alerts-service` |

---

## Additional Integrations

### Google Cloud Storage

| Field | Value |
|-------|-------|
| **Type** | Object storage |
| **Purpose** | Source-of-truth storage for PDF technical documents before indexing |
| **Auth** | Google service account credentials / ADC |
| **Env var** | `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS` |
| **Base URL** | Google Cloud Storage bucket endpoint (SDK-managed) |
| **Used by** | `packages/mcp-technical-advisory` |

### PageIndex

| Field | Value |
|-------|-------|
| **Type** | Hosted document processing and chat API |
| **Purpose** | Vectorless PDF indexing, tree generation, and document-grounded chat |
| **Auth** | API key |
| **Env var** | `PAGEINDEX_API_KEY` |
| **Base URL** | `https://api.pageindex.ai` |
| **Used by** | `packages/mcp-technical-advisory` |

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
