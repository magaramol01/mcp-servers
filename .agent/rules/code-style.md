# Code Style — MCP Servers Monorepo

## TypeScript

### Enforced by `tsconfig` (`strict: true`)

- `strictNullChecks` — no implicit `null` / `undefined`
- `noImplicitAny` — use `unknown` and narrow; never `any`
- `strictFunctionTypes` — covariant function types enforced
- `forceConsistentCasingInFileNames` — prevents cross-OS import bugs

### Key Patterns

```typescript
// ✅ Always async/await
const result = await db.collection("items").findOne({ id });

// ❌ Never .then() chains
db.collection("items").findOne({ id }).then(result => { ... });
```

```typescript
// ✅ Normalise all caught values before using
} catch (err) {
  const error = toError(err);            // from shared/utils
  log.error("operation failed", { error: error.message });
  throw error;
}

// ❌ Never cast unknown catches
} catch (err: any) { console.log(err.message) }
```

```typescript
// ✅ Typed filter/query objects
const filter: Record<string, unknown> = { status: "active" };
if (optionalField) filter.someField = optionalField;

// ❌ Never bypass the type system with casts
const filter = { status: "active" } as any;
```

### Import Order

1. Node built-ins (`node:path`, `node:fs`)
2. Third-party packages (`zod`, `mongodb`, `@modelcontextprotocol/sdk`)
3. Workspace packages (`@your-org/utils`)
4. Local files (`./tools/myTool.js`)

Always use `.js` extension in imports (required for `"module": "Node16"` ESM):
```typescript
// ✅ Correct
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ❌ Breaks at runtime in ESM
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
```

---

## Formatting

| Rule | Value |
|------|-------|
| Indentation | 2 spaces (no tabs) |
| Quotes | Double `"` |
| Semicolons | Always |
| Max line length | 100 characters |
| Trailing commas | `"all"` (ES5+) |

Prettier config:
```json
{
  "printWidth": 100,
  "singleQuote": false,
  "semi": true,
  "trailingComma": "all",
  "tabWidth": 2
}
```

---

## Naming

| Thing | Style | Example |
|-------|-------|---------|
| Variables | `camelCase` | `userId`, `resultCount` |
| Functions | `camelCase` verb | `connectDb`, `requireEnv` |
| Classes | `PascalCase` | `McpError`, `ValidationError` |
| Constants | `SCREAMING_SNAKE` | `MAX_RESULTS`, `DEFAULT_PORT` |
| Types / Interfaces | `PascalCase` | `Logger`, `ToolResult` |
| Files | `camelCase.ts` | `userTools.ts`, `dbHelper.ts` |
| Directories | `kebab-case` | `mcp-my-server`, `shared-utils` |

---

## Comments

- Use **JSDoc** on all exported functions in `shared/utils`
- Inline comments for non-obvious logic only — never restate what the code does
- Use `// ─── Section Name ────` separators in long files
- No commented-out code in committed files — use git history instead

---

## File Organisation in `src/index.ts`

Keep a consistent section order:

```typescript
// ─── Imports ───────
// ─── Logger ────────
// ─── Server Setup ──
// ─── Tools ─────────  (one block per tool)
// ─── Bootstrap ─────  (main(), SIGINT handler)
```
