import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  connectPostgres,
  createLogger,
  disconnectPostgres,
  requireEnv,
  toError,
} from "@mcpkit/utils";

const log = createLogger("mcp-emission-engineer");
const packageEnvPath = resolve(__dirname, "../.env");

if (existsSync(packageEnvPath)) {
  process.loadEnvFile(packageEnvPath);
}

const server = new McpServer({
  name: "mcpkit/mcp-emission-engineer",
  version: "1.0.0",
});

// ─── Tools ────────────────────────────────────────────────────────────────────
// Intentionally empty for now. This package currently boots the MCP server and
// validates the Emission Engineer PostgreSQL connection at startup.

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  const postgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");

  log.info("Starting mcp-emission-engineer...");
  await connectPostgres(postgresUrl);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("mcp-emission-engineer running on stdio");
}

process.on("SIGINT", async () => {
  log.info("Shutting down...");
  await disconnectPostgres();
  process.exit(0);
});

main().catch((err) => {
  log.error("Fatal startup error", { error: toError(err).message });
  process.exit(1);
});
