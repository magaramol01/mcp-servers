# MCP Tool API Conventions

> These rules apply to every tool registered in this monorepo.
> Read this before adding or modifying any tool.

---

## Transport: Streamable HTTP (only)

All MCP servers in this monorepo use the **Streamable HTTP** transport exclusively.
This is the official transport introduced in **MCP spec 2025-03-26**, replacing
the older stdio and HTTP+SSE transports.

### Why Streamable HTTP?

- Single HTTP endpoint (`/mcp`) for all communication
- Works over standard HTTP infrastructure (load balancers, proxies, firewalls)
- Supports server-to-client push via SSE streams within the same endpoint
- Session management with `Mcp-Session-Id` header
- Resumable streams via `Last-Event-ID` on reconnect
- Compatible with remote and browser-based MCP clients

---

## Standard Server Entry Point Pattern

Each MCP server package exposes an Express HTTP server using
`StreamableHTTPServerTransport`:

```typescript
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger, requireEnv, optionalEnv, disconnectDb, toError } from "@your-org/utils";

const log = createLogger("mcp-<server-name>");

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: "your-org/mcp-<server-name>", version: "1.0.0" });

// Register all tools here BEFORE connecting any transport
// server.tool(...)

// ─── Session Management ────────────────────────────────────────────────────────

// In-memory session store (replace with Redis for multi-instance / scaled deployments)
const sessions = new Map<string, StreamableHTTPServerTransport>();

function getOrCreateTransport(sessionId?: string): StreamableHTTPServerTransport {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
      log.info("Session created", { sessionId: id });
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId ?? "";
    sessions.delete(id);
    log.info("Session closed", { sessionId: id });
  };

  server.connect(transport).catch((err) => {
    log.error("Failed to connect transport", { error: toError(err).message });
  });

  return transport;
}

// ─── HTTP Endpoints ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Validate Origin header on all requests (security: prevent DNS rebinding)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = optionalEnv("ALLOWED_ORIGINS", "").split(",").filter(Boolean);
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  next();
});

// POST /mcp — client sends JSON-RPC messages
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  try {
    const transport = getOrCreateTransport(sessionId);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error("POST /mcp error", { error: toError(err).message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /mcp — client opens SSE stream for server-to-client notifications
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    log.error("GET /mcp error", { error: toError(err).message });
  }
});

// DELETE /mcp — client explicitly terminates the session
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.close();
  res.status(200).json({ message: "Session terminated" });
});

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  const PORT = optionalEnv("PORT", "3000");
  log.info(`Starting mcp-<server-name> on port ${PORT}...`);
  app.listen(Number(PORT), "0.0.0.0", () => {
    log.info(`mcp-<server-name> listening`, { port: PORT, endpoint: `http://0.0.0.0:${PORT}/mcp` });
  });
}

process.on("SIGINT", async () => {
  log.info("Shutting down — closing all sessions...");
  await Promise.all([...sessions.values()].map((t) => t.close()));
  await disconnectDb();
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal startup error", { error: toError(err).message });
  process.exit(1);
});
```

---

## Streamable HTTP Protocol Rules

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Client sends a JSON-RPC message. Server replies with JSON or upgrades to SSE stream |
| `GET` | `/mcp` | Client opens persistent SSE stream for server-to-client notifications |
| `DELETE` | `/mcp` | Client explicitly terminates the session |

### Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `Accept: application/json, text/event-stream` | Client → Server | Required on POST requests |
| `Accept: text/event-stream` | Client → Server | Required on GET (SSE) requests |
| `Mcp-Session-Id` | Server → Client | Assigned on `InitializeResult`, must be included on all subsequent requests |
| `Mcp-Session-Id` | Client → Server | Client echoes this on every subsequent request |
| `Last-Event-ID` | Client → Server | Sent on reconnect to resume missed SSE events |
| `MCP-Protocol-Version` | Client → Server | Protocol version (e.g. `2025-03-26`) |
| `Origin` | Client → Server | Validated server-side to prevent DNS rebinding attacks |

### Security Requirements (from spec)

1. **Validate `Origin` header** on all incoming connections — prevents DNS rebinding
2. **Bind to `127.0.0.1` only** when running locally — not `0.0.0.0`
3. **Implement authentication** for production deployments (e.g. Bearer tokens via `Authorization` header)

### Session Lifecycle

```
Client                              Server
  │── POST /mcp (InitializeRequest) ──→ │
  │←── 200 + Mcp-Session-Id header ─── │  ← session created
  │                                     │
  │── GET /mcp (Mcp-Session-Id) ──────→ │  ← open SSE stream
  │←── SSE stream ─────────────────── ─│
  │                                     │
  │── POST /mcp (tools/call) ─────────→ │
  │←── SSE: tool result ─────────────── │
  │                                     │
  │── DELETE /mcp (Mcp-Session-Id) ───→ │  ← terminate session
  │←── 200 OK ──────────────────────── │
```

---

## Dependencies Required Per Server Package

```bash
# Add to the server package (not root)
pnpm add express --filter=@your-org/mcp-<name>
pnpm add -D @types/express --filter=@your-org/mcp-<name>
```

Root `package.json` changes:
```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.10.1",
  "@your-org/utils": "workspace:*",
  "express": "^4.21.0",
  "zod": "^3.23.8"
}
```

---

## Environment Variables (transport-specific)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP port the server listens on |
| `ALLOWED_ORIGINS` | No | `""` (all) | Comma-separated list of allowed CORS origins |

---

## Testing Streamable HTTP Servers

### MCP Inspector

```bash
# Build first
pnpm turbo run build --filter=@your-org/mcp-<name>

# Start the server
PORT=3000 node packages/mcp-<name>/dist/index.js

# In another terminal — connect Inspector to HTTP
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

### Raw HTTP (curl)

```bash
# Step 1: Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'

# Step 2: List tools (use Mcp-Session-Id from the response above)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <session-id-from-step-1>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Step 3: Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <session-id-from-step-1>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"your_tool_name","arguments":{"key":"value"}}}'
```

---

## Tool Registration Pattern

Tool registration is transport-agnostic — same API regardless of transport:

```typescript
server.tool(
  "tool_name",                    // snake_case verb_noun
  "What this tool does",          // description written for the LLM — be specific
  { /* zod input schema */ },     // always required — never pass {}
  async (args) => { /* ... */ }   // handler
);
```

All four arguments are **mandatory**. Register all tools **before** calling `server.connect(transport)`.

---

## Tool Naming

| Prefix | Use | Example |
|--------|-----|---------|
| `get_` | Single resource by identifier | `get_user_by_id` |
| `list_` | Collection, optionally filtered | `list_open_tickets` |
| `search_` | Text or complex filter | `search_documents_by_keyword` |
| `count_` | Numeric aggregate only | `count_items_by_status` |
| `summarise_` | Grouped/aggregated data | `summarise_daily_stats` |

---

## Input Schema — Rules

```typescript
// ✅ All fields must have .describe() — the LLM reads these
id: z.string().describe("The unique record ID")

// ✅ Optional with a safe default
limit: z.number().min(1).max(100).default(20).describe("Max results (1-100)")

// ✅ Truly optional — the handler must handle undefined
status: z.string().optional().describe("Filter by status (omit for all)")

// ❌ No .describe() — LLM has no hint about this field's purpose
id: z.string()

// ❌ No bounds on numbers
limit: z.number()
```

---

## Output Shape — Rules

```typescript
return {
  content: [
    {
      type: "text",
      text: JSON.stringify(result, null, 2),  // always pretty-print
    },
  ],
};
```

- Empty collections → return `[]`, never `null`
- Single-item `get_` tools → return the object, not `[object]`
- Project only fields the LLM needs
- Never put errors inside `content` — **throw instead**

---

## Error Handling — Rules

```typescript
import { NotFoundError, ValidationError, toError } from "@your-org/utils";

throw new NotFoundError("User", id);
throw new ValidationError("id must be a non-empty string");

} catch (err) {
  const error = toError(err);
  log.error("tool_name failed", { error: error.message });
  throw error;  // MCP SDK converts to JSON-RPC error in SSE stream
}
```

---

## Adding a New Tool — Checklist

- [ ] Tool name is `snake_case` with a verb prefix
- [ ] All input fields have `.describe()`
- [ ] Numeric inputs have `.min()` / `.max()`
- [ ] Output is `JSON.stringify(result, null, 2)` inside `content[0].text`
- [ ] Errors are thrown, not returned in content
- [ ] Tool is registered **before** `server.connect(transport)` in `index.ts`
- [ ] Entry added to the tool reference table in `.agent/spec/design.md`
- [ ] Tested with MCP Inspector over HTTP (see Testing section above)
