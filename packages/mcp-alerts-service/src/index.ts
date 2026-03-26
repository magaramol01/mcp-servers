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

const log = createLogger("mcp-alerts-service");

const server = new McpServer({
  name: "mcpkit/mcp-alerts-service",
  version: "1.0.0",
});

// ─── Tools ────────────────────────────────────────────────────────────────────

server.tool(
  "list_unread_notifications",
  "List all unread shore notifications, optionally filtered by vessel",
  {
    vesselId: z.string().optional().describe("Optional vessel ObjectId filter"),
    limit: z.number().min(1).max(100).default(20).describe("Max results to return"),
  },
  async ({ vesselId, limit }) => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const filter: Record<string, unknown> = { read: false, isDeleted: { $ne: true } };
      if (vesselId) filter.vesselId = vesselId;

      const notifications = await db
        .collection("notifications")
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(notifications, null, 2) }],
      };
    } catch (err) {
      const error = toError(err);
      log.error("list_unread_notifications failed", { error: error.message });
      throw error;
    }
  }
);

server.tool(
  "list_pending_reopen_requests",
  "List all pending reopen requests from vessels",
  {},
  async () => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const requests = await db
        .collection("reopenrequests")
        .find({ status: "pending" })
        .sort({ createdAt: -1 })
        .toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(requests, null, 2) }],
      };
    } catch (err) {
      const error = toError(err);
      log.error("list_pending_reopen_requests failed", { error: error.message });
      throw error;
    }
  }
);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  log.info("Starting mcp-alerts-service...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("mcp-alerts-service running on stdio");
}

process.on("SIGINT", async () => {
  await disconnectMongo();
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal startup error", { error: toError(err).message });
  process.exit(1);
});
