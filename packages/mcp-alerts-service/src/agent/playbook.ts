import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PLAYBOOK_URI = "alerts-service://playbook";
const RULE_ENGINE_SCHEMA = "shipping_db";

function buildPlaybookPayload(): Record<string, unknown> {
  return {
    server: "mcpkit/mcp-alerts-service",
    environment: {
      requiredAtStartup: ["ALERTS_SERVICE_POSTGRES_URL"],
      optional: ["ALERTS_SERVICE_HOST", "ALERTS_SERVICE_PORT", "HOST", "PORT"],
      tenantMeaning:
        "The `tenant` tool argument is the PostgreSQL database name (single path segment). The server opens a connection to `.../tenant` derived from ALERTS_SERVICE_POSTGRES_URL.",
    },
    backend: {
      postgres: {
        schema: RULE_ENGINE_SCHEMA,
        executionTables: [
          "std_triggeredoutcomestoday",
          "std_triggeredoutcomeshistory",
        ],
        ruleTables: [
          "std_ruleblocks",
          "std_ruleconfigs",
          "ship",
          "standardparameters",
        ],
      },
      expectedExecutionFields: [
        "source_scope",
        "source_table",
        "rule_id",
        "rule_name",
        "advisory_id",
        "vessel_id",
        "vessel_mapping_name",
        "vessel_name",
        "acknowledge_status",
        "observant_type",
        "executed_at",
        "live_value",
        "live_value_unit",
        "machine_type",
        "company_name",
        "summary",
        "payload_json",
      ],
      expectedRuleFields: [
        "source_scope",
        "rule_id",
        "rule_name",
        "description",
        "enabled",
        "company_name",
        "user_id",
        "vessel_id",
        "vessel_mapping_name",
        "vessel_name",
        "raw_rule_refs",
        "evaluation_factor",
        "evaluation_method",
        "rule_configs",
      ],
    },
    tools: [
      {
        name: "get_recent_execute_alerts",
        description:
          "Return the most recent triggered outcomes for a tenant database using the std_triggeredoutcomes tables, deduplicating today/history writes.",
      },
      {
        name: "describe_rules",
        description:
          "Return std_ruleblock metadata with linked std_ruleconfig details for a tenant database.",
      },
    ],
    resources: {
      playbookUri: PLAYBOOK_URI,
      note: "Read this URI via MCP resources/read for the same JSON as get_alerts_service_playbook.",
    },
  };
}

export function getPlaybookJsonText(): string {
  return JSON.stringify(buildPlaybookPayload(), null, 2);
}

export const MCP_SERVER_INSTRUCTIONS = [
  "Alerts-service MCP: per-tenant Rule Engine alert execution retrieval and rule description lookup.",
  "Requires env ALERTS_SERVICE_POSTGRES_URL at process startup.",
  "Tool argument `tenant` selects the PostgreSQL database name (single path segment) derived from ALERTS_SERVICE_POSTGRES_URL.",
  "The service reads Rule Engine tables from the shipping_db schema.",
  "For backend field requirements and tool usage, call get_alerts_service_playbook or read resource alerts-service://playbook.",
].join("\n");

export function registerAgentPlaybookSurface(server: McpServer): void {
  const text = getPlaybookJsonText();

  server.registerResource(
    "alerts_service_playbook",
    PLAYBOOK_URI,
    {
      description:
        "Machine-readable environment, tenant, relation, and tool contract for the alerts service",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text,
        },
      ],
    }),
  );

  server.tool(
    "get_alerts_service_playbook",
    "Return JSON describing the alerts service environment variables, tenant semantics, normalized backend contract, and available tools.",
    {},
    async () => ({
      content: [{ type: "text", text }],
    }),
  );
}
