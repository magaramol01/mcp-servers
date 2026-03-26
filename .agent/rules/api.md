# MCP Tool API Conventions

> These rules apply to every `server.tool()` registered in this monorepo.
> Read this before adding or modifying any tool.

---

## Tool Registration

```typescript
server.tool(
  "tool_name",                    // snake_case verb_noun — see naming rules below
  "What this tool does",          // description written for the LLM — be specific
  { /* zod input schema */ },     // always required — never pass {}
  async (args) => { /* ... */ }   // handler
);
```

All four arguments are **mandatory**. Never omit the schema object.

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

// ❌ No bounds on numbers — could send thousands of rows to the LLM
limit: z.number()
```

---

## Output Shape — Rules

```typescript
// ✅ Standard return shape — always this structure
return {
  content: [
    {
      type: "text",
      text: JSON.stringify(result, null, 2),  // pretty-print for LLM readability
    },
  ],
};
```

- Empty collections → return `[]`, never `null`
- Single-item `get_` tools → return the object directly, not `[object]`
- Project only fields the LLM actually needs — avoid returning entire DB documents
- Never put error messages inside `content` — **throw instead**

---

## Error Handling — Rules

```typescript
import { NotFoundError, ValidationError, toError } from "@your-org/utils";

// ✅ Use typed error classes for known failures
throw new NotFoundError("User", id);
throw new ValidationError("id must be a non-empty string");

// ✅ Always normalise unknown caught values
} catch (err) {
  const error = toError(err);
  log.error("tool_name failed", { error: error.message, /* relevant input */ });
  throw error;  // re-throw — MCP SDK converts thrown errors to JSON-RPC error responses
}

// ❌ Never return errors inside content
return { content: [{ type: "text", text: "Error: not found" }] };

// ❌ Never swallow errors silently
} catch (err) { /* do nothing */ }
```

---

## Logging in Tool Handlers

```typescript
// Logger namespace should be the server name (set once per file, at the top)
const log = createLogger("mcp-<server-name>");

// ✅ Log on error with relevant context — help yourself debug production issues
log.error("list_items failed", { status, error: error.message });

// ✅ Debug-level tracing — only visible at LOG_LEVEL=debug, not in prod
log.debug("querying data source", { filter });

// ❌ Avoid info/success logs on the hot path — MCP tools run frequently
log.info("tool succeeded");   // this prints on every tool call
```

---

## Adding a New Tool — Checklist

- [ ] Tool name follows `snake_case` verb prefix convention
- [ ] Tool description is written for the LLM (clear, specific, imperative)
- [ ] All input fields have `.describe()`
- [ ] Numeric inputs have `.min()` and `.max()`
- [ ] Handler reads config via `requireEnv` / `optionalEnv`
- [ ] Output is `JSON.stringify(result, null, 2)` inside `content[0].text`
- [ ] Errors are thrown (not returned in content)
- [ ] Tool is registered **before** `server.connect(transport)` in `index.ts`
- [ ] Entry added to the tool reference table in `.agent/spec/design.md`
- [ ] Tested with MCP Inspector (see `DEVELOPER_GUIDE.md`)
