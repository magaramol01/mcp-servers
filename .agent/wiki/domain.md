# Domain Knowledge

> This file captures domain-specific knowledge relevant to your organization's
> MCP servers. Fill it in with context that an AI agent needs to understand
> your data models, business logic, and industry terminology.
>
> **Why this matters:** Without domain context, an AI agent may generate
> technically correct code that is semantically wrong for your business.

---

## What This Monorepo Does

<!-- Replace this section with a description of your business domain -->

This collection of MCP servers exposes [your organization]'s [domain] data to
AI assistants. The servers provide read access to [brief description of data].

---

## Key Domain Concepts

> List the primary entities, states, and relationships in your system.
> Example structure below — replace with your own.

### [Entity Name]

- **What it is:** Description of what this entity represents
- **Key identifiers:** The fields used to uniquely identify it
- **Statuses / lifecycle:** The states it can be in (e.g. `active`, `archived`)
- **Relationships:** How it relates to other entities

### [Another Entity]

- **What it is:** ...
- **Key identifiers:** ...

---

## Status / State Machines

> Document any important status flows your tools will encounter.

```
[Status A] → [Status B] → [Status C]
         ↘                ↗
           [Status D]
```

| Status | Meaning |
|--------|---------|
| `status_a` | What this status means in the business context |
| `status_b` | ... |

---

## Industry / Domain Terminology

> List terms from your domain that an AI agent might not know.

| Term | Definition |
|------|------------|
| Term A | What it means |
| Term B | What it means |

---

## Data Sources Overview

| Source | Type | What it contains |
|--------|------|-----------------|
| Primary DB | PostgreSQL / MongoDB / etc. | Core operational data |
| External API | REST | [describe] |

---

## Business Rules Agents Must Know

1. **[Rule 1]:** Description of a non-obvious business rule
2. **[Rule 2]:** Another rule affecting how data should be queried or presented
3. **Soft deletes:** If applicable — describe the pattern used (e.g. `isDeleted`, `deletedAt`)

---

## What to Avoid

- Do not expose [sensitive data] in tool outputs
- Do not interpret [field X] as [wrong meaning] — it actually means [correct meaning]
