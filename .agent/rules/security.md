# Security Rules — MCP Servers Monorepo

## Secrets & Credentials

### Non-Negotiable Rules

1. **Never hardcode secrets** — no connection strings, passwords, API keys, or tokens in source
2. **Never commit `.env` files** — only `.env.example` (with no real values) is committed
3. **Never log secret values** — do not log env var values, tokens, or connection strings
4. **Always use the env helper** — `requireEnv("KEY")` fails fast at startup if the variable is missing

### Correct Pattern

```typescript
// ✅ Use the shared env helper — throws at startup if missing
const DB_URI   = requireEnv("DATABASE_URI");
const APP_PORT = optionalEnv("PORT", "3000");
```

```typescript
// ❌ Never inline process.env without validation
const uri = process.env.DATABASE_URI;  // could be undefined — silent bug
```

```typescript
// ❌ Never hardcode
const uri = "mongodb://admin:secret@prod-server:27017";
```

```typescript
// ❌ Never log secret values
log.info("Starting", { uri: process.env.DATABASE_URI });

// ✅ Log safe context only
log.info("Connecting to database", { dbName });
```

---

## Environment Variables in Production

- Inject secrets at runtime via your secret management system
  (GCP Secret Manager, AWS Secrets Manager, Vault, K8s Secrets, etc.)
- Docker containers receive secrets via `-e` flags or orchestrator injection
- **Never pass secrets via Docker build `ARG`** — they appear in image layer history

---

## MCP Server Trust Model

Document your trust model here. Common options:

| Model | When to use |
|-------|-------------|
| **Fully trusted (server-side)** | MCP server runs inside your private infra; no per-user auth needed |
| **Token-validated** | MCP server is client-facing; validate a bearer token per request |
| **Network-isolated** | VPC/firewall is the auth boundary; internal services only |

> Default in this monorepo: **Server-side trusted execution**.
> If you add client-facing servers in future, implement auth at the transport
> layer, not inside individual tool handlers.

---

## Data Access Principles

- **Principle of least privilege:** Use a read-only DB user for read-only MCP servers
- **Read-only by default:** MCP servers should not perform writes unless explicitly
  designed to do so — document any server that has write access
- Never use an admin/root database credential in application config

---

## Docker Security

- Use `node:20-slim` (or equivalent slim/distroless base) — minimal attack surface
- Do not run containers as root — add `USER node` in Dockerfile if possible
- Set `NODE_ENV=production` in runtime images
- No secrets baked into images — all via runtime env injection

---

## Dependency Security

```bash
# Run before every release
pnpm audit

# Fix safe/non-breaking vulnerabilities automatically
pnpm audit --fix
```

- Pin major versions in `package.json` (e.g. `"^1.10.1"` not `"latest"`)
- Review dependency update PRs before auto-merging — check changelogs for breaking changes
- Remove unused packages — every unused dependency is an attack surface
