# Design — MCP Tool API Patterns

## Tool Naming Convention

All tools use `snake_case` with a verb prefix:

| Prefix | Use case | Example |
|--------|----------|---------|
| `get_` | Fetch a single resource by identifier | `get_user_by_id` |
| `list_` | Fetch a filtered collection | `list_open_tickets` |
| `search_` | Text/complex filter across a collection | `search_documents` |
| `count_` | Return a numeric aggregate only | `count_pending_items` |
| `summarise_` | Return an aggregated summary | `summarise_weekly_stats` |

---

## Tool Registration Pattern

```typescript
server.tool(
  "tool_name",                  // snake_case verb_noun
  "What this tool does",        // description for the LLM — be specific
  {
    /* zod schema for inputs */
  },
  async (args) => {
    /* handler */
  }
);
```

All four arguments are **required**. Never register a tool without a schema.

---

## Input Schema Rules

```typescript
// ✅ Required field — always add .describe() for the LLM
id: z.string().describe("The unique identifier of the resource")

// ✅ Optional field with default
limit: z.number().min(1).max(100).default(20).describe("Max results (1-100)")

// ✅ Optional field without default
filter: z.string().optional().describe("Optional status filter")

// ❌ No description — LLM cannot understand the purpose of this field
id: z.string()

// ❌ Unbounded number — always add .min() / .max()
limit: z.number()
```

---

## Output Shape

All tools must return:

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

**Output rules:**
- `JSON.stringify` with `null, 2` for LLM readability
- For empty collections, return `[]` — never `null`
- For single-resource `get_` tools, return the object directly (not wrapped in array)
- Project/select only fields the LLM needs — avoid massive document dumps
- Never return errors inside `content` — throw instead (MCP SDK handles formatting)

---

## Error Handling Pattern

```typescript
import { NotFoundError, ValidationError, toError } from "@your-org/utils";

// Use typed errors for known failure cases
throw new NotFoundError("User", id);
throw new ValidationError("id must be a valid UUID");

// Normalise unknown caught values before re-throwing
} catch (err) {
  const error = toError(err);
  log.error("tool_name failed", { error: error.message });
  throw error;  // re-throw — MCP SDK wraps in JSON-RPC error response
}
```

---

## Logging Inside Tools

```typescript
const log = createLogger("mcp-<server-name>");  // one logger per server

// Log errors with relevant context
log.error("tool failed", { inputField: value, error: error.message });

// Debug for tracing — only visible at LOG_LEVEL=debug
log.debug("querying data source", { filter });

// Avoid info-level logging on the success path (noisy on stdio transport)
```

---

## Tool Reference Table

> Maintain this table as you add tools. One row per tool.

| Package | Tool Name | Input | Returns |
|---------|-----------|-------|---------|
| `packages/<server>` | `tool_name` | `{ field: type }` | Description of return value |

---

## Common Query Patterns (adapt to your data source)

### Filter soft-deleted records
```typescript
{ isDeleted: { $ne: true } }   // MongoDB example
```

### Always project needed fields only
```typescript
.project({ name: 1, status: 1, _id: 1 })
```

### Always limit unbounded queries
```typescript
.limit(args.limit ?? 20)
```

### Group by a field for summaries
```typescript
[
  { $match: { /* filter */ } },
  { $group: { _id: "$status", count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]
```
