import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger } from "@mcpkit/utils";
import { toAgentFriendlyDbError } from "../dbErrors.js";
import type { AlertsRepository } from "../repository/types.js";
import { normalizeTimestampInput } from "./shared.js";

const log = createLogger("mcp-alerts-service:get-recent-execute-alerts");

export function registerGetRecentExecuteAlertsTool(
  server: McpServer,
  repository: AlertsRepository,
): void {
  server.tool(
    "get_recent_execute_alerts",
    "Return the most recent triggered alert executions for a tenant database using the Rule Engine triggered outcome tables, ordered newest first.",
    {
      tenant: z
        .string()
        .trim()
        .min(1)
        .describe("Tenant PostgreSQL database name"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of alert executions to return (1-100)"),
      ruleId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact rule identifier filter"),
      status: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact acknowledge status filter from the triggered outcomes tables"),
      since: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional ISO-8601 timestamp; only return executions at or after this time"),
    },
    async ({ tenant, limit, ruleId, status, since }) => {
      const normalizedSince = normalizeTimestampInput("since", since);

      try {
        const executions = await repository.getRecentExecuteAlerts({
          tenant,
          limit,
          ruleId,
          status,
          since: normalizedSince,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(executions, null, 2) }],
        };
      } catch (err) {
        const error = toAgentFriendlyDbError(err);
        log.error("get_recent_execute_alerts failed", {
          tenant,
          limit,
          ruleId,
          status,
          since: normalizedSince,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
