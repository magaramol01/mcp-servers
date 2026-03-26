import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createLogger,
  requireEnv,
  optionalEnv,
  connectMongo,
  disconnectMongo,
  NotFoundError,
  toError,
} from "@mcpkit/utils";

const log = createLogger("mcp-vessel-tracker");

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcpkit/mcp-vessel-tracker",
  version: "1.0.0",
});

// ─── Tools ────────────────────────────────────────────────────────────────────

server.tool(
  "get_vessel_position",
  "Get the current GPS position and status of a vessel by its IMO number",
  {
    imo: z.string().describe("IMO vessel identifier"),
  },
  async ({ imo }) => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const vessel = await db.collection("vessels").findOne({ imo });

      if (!vessel) throw new NotFoundError("Vessel", imo);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                imo: vessel.imo,
                name: vessel.name,
                position: vessel.position ?? null,
                speed: vessel.speed ?? null,
                heading: vessel.heading ?? null,
                status: vessel.status ?? "unknown",
                lastUpdated: vessel.lastUpdated ?? null,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const error = toError(err);
      log.error("get_vessel_position failed", { imo, error: error.message });
      throw error;
    }
  }
);

server.tool(
  "list_active_vessels",
  "List all vessels currently active in the fleet",
  {},
  async () => {
    const MONGO_URI = requireEnv("MONGO_URI");
    const DB_NAME = optionalEnv("DB_NAME", "fo-shore");

    try {
      const db = await connectMongo(MONGO_URI, DB_NAME);
      const vessels = await db
        .collection("vessels")
        .find({ isDeleted: { $ne: true } })
        .project({ name: 1, imo: 1, status: 1, shipId: 1 })
        .toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(vessels, null, 2) }],
      };
    } catch (err) {
      const error = toError(err);
      log.error("list_active_vessels failed", { error: error.message });
      throw error;
    }
  }
);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  log.info("Starting mcp-vessel-tracker...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("mcp-vessel-tracker running on stdio");
}

process.on("SIGINT", async () => {
  log.info("Shutting down...");
  await disconnectMongo();
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal startup error", { error: toError(err).message });
  process.exit(1);
});
