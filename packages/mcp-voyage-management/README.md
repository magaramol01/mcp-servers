# mcp-voyage-management

MCP server hosting Voyage Agent's tools that reach Voyage Management
Service and Reports Agent, over `StreamableHTTPServerTransport` at `/mcp`
(same convention as `mcp-alerts-service`/`mcp-emission-engineer`).

Tool scope is tracked in `Plan/mcp-voyage-management-tools-plan.md` in the
`VPM_2.0` workspace root (not this repo) — read that before adding a tool.
Architecture/decision context: `Plan/voyage-agent-service-plan.md` Section
6/9a in that same workspace.

## Tools registered

| Tool | Calls | Notes |
|---|---|---|
| `get_vessel_position` | Voyage Management Service (`live-tracking/travelled-path`) | "Position" = most recent point on the travelled path for a voyage — VMS has no dedicated position/fleet endpoint. See the tool's own file doc for the vessel→voyage resolution heuristic used when only a vessel is given. |
| `query_voyages` | Voyage Management Service (`voyages/`) | Only `voyageId` lookup and `vesselId` listing are supported server-side — no status/date-range filter exists yet. |
| `reports_agent` | Reports Agent (`reports/<type>/generate`, `generated-reports/`) | `generate` and `open` in one tool. Tropical Storm has no `open` path (Reports Agent doesn't expose one). Passage Weather's `generate` needs route waypoints Voyage Agent doesn't extract from plain text yet. |

**Not registered yet:** `alert_agent` — Alert Agent has no running service
or documented REST API (only a module-structure sketch in
`Plan/alert-agent-service-plan.md`, no concrete routes). Add it once that
exists; see `Plan/mcp-voyage-management-tools-plan.md` Section 2/3.

## Identity

Every tool takes a required `actor: { userId, email, role, companyName }`
argument — Voyage Agent's own verified identity (never re-derived here),
forwarded as `x-user-id`/`x-user-email`/`x-user-role`/`x-company-name` on
every downstream call. This package never re-checks vessel assignment or
confirmation — both already happened in Voyage Agent before a tool is ever
called (Section 1 of the tools plan).

## Env

See `.env.example`. `VOYAGE_MANAGEMENT_SERVICE_BASE_URL`/`_GATEWAY_KEY` and
`REPORTS_AGENT_BASE_URL`/`_GATEWAY_KEY` are required at startup — both
target services must add this package's gateway key to their own
`INTERNAL_GATEWAY_KEYS` allow-list (a distinct key from Voyage Agent's own).

## Run

```
pnpm --filter=@mcpkit/mcp-voyage-management dev
```
