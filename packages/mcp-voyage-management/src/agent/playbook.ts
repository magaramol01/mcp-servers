import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PLAYBOOK_URI = "voyage-management://playbook";

function buildPlaybookPayload(): Record<string, unknown> {
  return {
    server: "mcpkit/mcp-voyage-management",
    environment: {
      requiredAtStartup: [
        "VOYAGE_MANAGEMENT_SERVICE_BASE_URL",
        "VOYAGE_MANAGEMENT_SERVICE_GATEWAY_KEY",
        "REPORTS_AGENT_BASE_URL",
        "REPORTS_AGENT_GATEWAY_KEY",
      ],
      optional: ["VOYAGE_MANAGEMENT_MCP_HOST", "VOYAGE_MANAGEMENT_MCP_PORT", "HOST", "PORT"],
      actorMeaning:
        "Every tool takes a required `actor: { userId, email, role, companyName }` argument — Voyage Agent's own verified identity, forwarded as x-user-*/x-company-name on every downstream call. Never derived or trusted from any other field.",
    },
    backend: {
      callsOnly: ["Voyage Management Service (REST)", "Reports Agent (REST)"],
      neverConnectsDirectlyTo: "any database — see Plan/mcp-voyage-management-tools-plan.md Section 1",
    },
    tools: [
      {
        name: "get_vessel_position",
        description:
          "Most recently known position (from travelled path) and recent track for a vessel's most recent voyage, or a specific voyageId.",
      },
      {
        name: "query_voyages",
        description: "Look up one voyage by id, or list every voyage for a vessel.",
      },
      {
        name: "reports_agent",
        description: "Generate a new report, or open/list already-generated reports, for one of 5 report types.",
      },
    ],
    notYetRegistered: [
      {
        name: "alert_agent",
        reason:
          "Alert Agent has no running service or documented REST API yet — only a module-structure sketch in Plan/alert-agent-service-plan.md, no concrete routes to build against. See Plan/mcp-voyage-management-tools-plan.md Section 2.",
      },
    ],
    resources: {
      playbookUri: PLAYBOOK_URI,
      note: "Read this URI via MCP resources/read for the same JSON as get_voyage_management_playbook.",
    },
  };
}

export function getPlaybookJsonText(): string {
  return JSON.stringify(buildPlaybookPayload(), null, 2);
}

export const MCP_SERVER_INSTRUCTIONS = [
  "Voyage-management MCP: Voyage Agent's tools for vessel position, voyage lookup, and report generation/retrieval.",
  "Requires env VOYAGE_MANAGEMENT_SERVICE_BASE_URL/_GATEWAY_KEY and REPORTS_AGENT_BASE_URL/_GATEWAY_KEY at process startup.",
  "Every tool call requires an `actor` argument — Voyage Agent's verified identity, never re-derived here.",
  "For environment/tool details, call get_voyage_management_playbook or read resource voyage-management://playbook.",
].join("\n");

export function registerAgentPlaybookSurface(server: McpServer): void {
  const text = getPlaybookJsonText();

  server.registerResource(
    "voyage_management_playbook",
    PLAYBOOK_URI,
    {
      description: "Machine-readable environment, actor, backend, and tool contract for mcp-voyage-management",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.toString(), mimeType: "application/json", text }],
    })
  );

  server.tool(
    "get_voyage_management_playbook",
    "Return JSON describing this server's environment variables, actor contract, backend calls, and available tools.",
    {},
    async () => ({ content: [{ type: "text", text }] })
  );
}
