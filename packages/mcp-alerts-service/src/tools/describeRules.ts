import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger } from "@mcpkit/utils";
import { toAgentFriendlyDbError } from "../dbErrors.js";
import type { AlertsRepository } from "../repository/types.js";

const log = createLogger("mcp-alerts-service:describe-rules");

export function registerDescribeRulesTool(
  server: McpServer,
  repository: AlertsRepository,
): void {
  server.tool(
    "describe_rules",
    "Return Rule Engine rule block metadata, evaluation settings, and linked rule configs for a tenant database.",
    {
      tenant: z
        .string()
        .trim()
        .min(1)
        .describe("Tenant PostgreSQL database name"),
      ruleId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact rule block identifier filter"),
      enabledOnly: z
        .boolean()
        .default(false)
        .describe("When true, return only enabled rule blocks"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of rules to return (1-100)"),
    },
    async ({ tenant, ruleId, enabledOnly, limit }) => {
      try {
        const rules = await repository.describeRules({
          tenant,
          ruleId,
          enabledOnly,
          limit,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(rules, null, 2) }],
        };
      } catch (err) {
        const error = toAgentFriendlyDbError(err);
        log.error("describe_rules failed", {
          tenant,
          ruleId,
          enabledOnly,
          limit,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
