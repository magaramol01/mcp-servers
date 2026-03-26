import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createLogger,
  requireEnv,
  optionalEnv,
  connectMongo,
  disconnectMongo,
  toError,
} from "@mcpkit/utils";

const log = createLogger("mcp-port-analytics");

const server = new McpServer({
  name: "mcpkit/mcp-port-analytics",
  version: "1.0.0",
});

// ─── Tools ────────────────────────────────────────────────────────────────────

server.tool(
  "get_report_summary",
  "Get a summary of submitted reports grouped by status for a given vessel",
  {
    vesselId: z.string().describe("MongoDB ObjectId of the vessel"),
  },
  async ({ vesselId }) => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const pipeline = [
        { $match: { vesselId, isDeleted: { $ne: true } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ];

      const result = await db.collection("reports").aggregate(pipeline).toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const error = toError(err);
      log.error("get_report_summary failed", { vesselId, error: error.message });
      throw error;
    }
  }
);

server.tool(
  "list_overdue_reports",
  "List all reports that are past their due date and still pending",
  {
    vesselId: z.string().optional().describe("Optional vessel filter"),
  },
  async ({ vesselId }) => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const filter: Record<string, unknown> = {
        status: "pending",
        dueDate: { $lt: new Date() },
        isDeleted: { $ne: true },
      };
      if (vesselId) filter.vesselId = vesselId;

      const reports = await db
        .collection("reports")
        .find(filter)
        .project({ reportName: 1, vesselId: 1, dueDate: 1, status: 1 })
        .sort({ dueDate: 1 })
        .toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(reports, null, 2) }],
      };
    } catch (err) {
      const error = toError(err);
      log.error("list_overdue_reports failed", { error: error.message });
      throw error;
    }
  }
);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  log.info("Starting mcp-port-analytics...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("mcp-port-analytics running on stdio");
}

process.on("SIGINT", async () => {
  await disconnectMongo();
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal startup error", { error: toError(err).message });
  process.exit(1);
});
