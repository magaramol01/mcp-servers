# mcp-voyage-management

Placeholder — package not implemented yet.

This will be the MCP server hosting every tool Voyage Agent calls, except
`route-optimization.tool.ts` (which stays local to Voyage Agent itself —
see that plan's Section 6/9). Tools query Voyage Management Service's own
REST API (never a direct DB connection), same `StreamableHTTPServerTransport`
+ `/mcp` convention as this repo's other packages (`mcp-alerts-service`,
`mcp-emission-engineer`).

Which tools, in what order: `Plan/mcp-voyage-management-tools-plan.md` in
the `VPM_2.0` workspace root (not this repo) — that's where tool scope is
decided before any of it is built here.

Architecture/decision context: `Plan/voyage-agent-service-plan.md` Section
6/9a in that same workspace.
