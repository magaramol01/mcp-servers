# Git Rules — MCP Servers Monorepo

## Branching Strategy

```
main          ← production-ready; protected; requires PR + passing CI
  └── feat/<ticket>-<short-desc>     ← new feature or new tool
  └── fix/<ticket>-<short-desc>      ← bug fix
  └── chore/<ticket>-<short-desc>    ← dependency updates, config, tooling
  └── docs/<ticket>-<short-desc>     ← documentation only
  └── refactor/<ticket>-<short-desc> ← code restructure, no behaviour change
```

**Rules:**
- Branch names use `kebab-case`
- Never push directly to `main`
- Delete branches after merging

---

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description in imperative mood>

[optional body — explain WHY, not WHAT]

[optional footer: BREAKING CHANGE: ..., or Closes #123]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New tool, new feature, new shared utility |
| `fix` | Bug fix |
| `chore` | Dependency bump, config change, no logic change |
| `docs` | Documentation only |
| `refactor` | Code restructure with no behaviour change |
| `test` | Adding or updating tests |
| `ci` | CI/CD pipeline changes |
| `build` | Build system changes (`turbo.json`, `Dockerfile`, etc.) |

### Scopes

Use the short package name (without the `@org/` prefix):

| Scope | Package |
|-------|---------|
| `mcp-<name>` | A specific MCP server package |
| `utils` | `shared/utils` |
| `tsconfig` | `shared/tsconfig` |
| `ci` | `.github/workflows/*` |
| `root` | Root `package.json`, `turbo.json`, `pnpm-workspace.yaml` |

### Good vs Bad Examples

```bash
# ✅ Good
feat(mcp-tickets): add list_open_tickets tool
fix(utils): handle undefined return from connectDb on timeout
chore(root): bump turbo to 2.9.0
docs(mcp-tickets): update README with tool usage examples
ci: add Docker push step on main merge

# ❌ Bad
updated stuff
fix bug
WIP
added new tool
```

---

## Pull Request Rules

- **Title** matches Conventional Commits format (same as commits)
- **Description** must include:
  - What changed and **why**
  - How to test it locally (MCP Inspector command or raw JSON-RPC call)
  - Link to the relevant issue/ticket
- All CI checks must be **green** before merge
- At least **1 approval** required (enforced via `CODEOWNERS`)
- **Squash merge** to `main` to keep history linear and clean

---

## Changesets with PRs

If your PR changes any code in `packages/` or `shared/`:

```bash
# 1. Create a changeset describing what changed
pnpm changeset

# 2. Commit the generated file with your branch
git add .changeset/
git commit -m "chore: add changeset for feat(mcp-tickets)"
```

Include the `.changeset/*.md` file in your PR. Do not skip this for code changes.
