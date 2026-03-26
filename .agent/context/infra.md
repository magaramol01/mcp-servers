# Infrastructure

> Document your infra setup here. The sections below are a recommended structure.
> Fill in the specifics for your deployment environment.

---

## Docker

### Build rule — always from repo root

```bash
# ✅ Correct — context is repo root so COPY shared/ paths resolve
docker build \
  -f packages/<server-name>/Dockerfile \
  -t your-org/<server-name>:latest \
  .

# ❌ Wrong — COPY shared/ will fail
cd packages/<server-name> && docker build .
```

### Image tagging convention

```
your-org/<server-name>:<git-sha>     ← CI/CD builds
your-org/<server-name>:latest        ← most recent main build
your-org/<server-name>:v1.2.3        ← versioned release tag
```

### Multi-stage build stages

| Stage | Base image | Purpose |
|-------|------------|---------|
| `base` | `node:20-slim` | Enable corepack / pnpm |
| `deps` | `base` | Install only this package's workspace dependencies |
| `builder` | `deps` | Run `turbo build --filter=<package>` |
| `runtime` | `node:20-slim` | Copy compiled `dist/` only — lean final image |

### Local Docker Compose

A `docker-compose.yml` at the repo root can spin up all servers + data sources:

```bash
docker compose up --build          # start everything
docker compose down                # teardown
docker compose logs -f <service>   # tail a single server's logs
```

---

## CI/CD Pipeline

### Pull Requests

- `turbo typecheck --filter=[HEAD^1]` — typecheck affected packages only
- `turbo build --filter=[HEAD^1]` — build affected packages only

The `--filter=[HEAD^1]` flag ensures only packages touched in the PR are checked,
keeping CI fast as the monorepo grows.

> Requires `fetch-depth: 2` in the GitHub Actions `checkout` step.

### Main Branch / Releases

- Docker images built per-package via a **matrix strategy** in GitHub Actions
- Images pushed to your container registry
- Deployed to your hosting environment (Cloud Run, ECS, K8s, etc.)

---

## Hosting

> Fill in your deployment details.

| Server | Hosting | Region | Min instances |
|--------|---------|--------|---------------|
| `packages/<server-name>` | Cloud Run / ECS / K8s | — | 0 (scale to zero) |

---

## Secrets Management

| Environment | Secret store |
|-------------|-------------|
| Local | `.env` file (gitignored) |
| Staging | [Your secret manager — e.g. GCP Secret Manager, AWS SM, Vault] |
| Production | [Your secret manager] |

---

## Infrastructure as Code

> Link to your IaC config (Terraform, Pulumi, CDK) if applicable.

- Terraform modules: `[link or path]`
- Environment: `[link or path]`
