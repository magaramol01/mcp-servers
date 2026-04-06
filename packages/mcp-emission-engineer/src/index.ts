import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  connectPostgres,
  createLogger,
  disconnectPostgres,
  requireEnv,
  toError,
} from "@mcpkit/utils";
import { registerAggregateEmissionsByVoyageTool } from "./tools/aggregateEmissionsByVoyage.js";
import { registerCalculateCiiRatingTool } from "./tools/calculateCiiRating.js";
import { registerCalculateEmissionsFromFuelTool } from "./tools/calculateEmissionsFromFuel.js";
import { registerClassifyEmissionsByScopeTool } from "./tools/classifyEmissionsByScope.js";
import { registerFleetCiiSummaryTool } from "./tools/fleetCiiSummary.js";
import { registerGetVesselAisTool } from "./tools/getVesselAis.js";
import { registerTraceCiiCalculationInputsTool } from "./tools/traceCiiCalculationInputs.js";
import { registerValidateNoonReportSeriesTool } from "./tools/validateNoonReportSeries.js";

const log = createLogger("mcp-emission-engineer");
const packageEnvPath = resolve(__dirname, "../.env");
const MCP_PATH = "/mcp";
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;

if (existsSync(packageEnvPath)) {
  process.loadEnvFile(packageEnvPath);
}

type SessionContext = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, SessionContext>();
let httpServer: ReturnType<typeof createServer> | null = null;
let isShuttingDown = false;

function createMcpServer() {
  const server = new McpServer({
    name: "mcpkit/mcp-emission-engineer",
    version: "1.0.0",
  });

  registerAggregateEmissionsByVoyageTool(server);
  registerCalculateCiiRatingTool(server);
  registerCalculateEmissionsFromFuelTool(server);
  registerClassifyEmissionsByScopeTool(server);
  registerFleetCiiSummaryTool(server);
  registerGetVesselAisTool(server);
  registerTraceCiiCalculationInputsTool(server);
  registerValidateNoonReportSeriesTool(server);

  return server;
}

function getHost(): string {
  return process.env.EMISSION_ENGINEER_HOST ?? process.env.HOST ?? DEFAULT_HOST;
}

function getPort(): number {
  const rawPort =
    process.env.EMISSION_ENGINEER_PORT ?? process.env.PORT ?? String(DEFAULT_PORT);
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }

  return port;
}

function getSessionId(req: IncomingMessage): string | undefined {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

function isInitializePayload(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((message) => isInitializeRequest(message));
  }

  return isInitializeRequest(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  if (res.headersSent) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendJsonRpcError(
  res: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  sendJson(res, statusCode, {
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function sendText(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

async function closeAllSessions(): Promise<void> {
  const activeSessions = Array.from(sessions.entries());

  sessions.clear();

  await Promise.all(
    activeSessions.map(async ([sessionId, { server, transport }]) => {
      try {
        await transport.close();
      } catch (error) {
        log.warn("Failed to close MCP transport cleanly", {
          sessionId,
          error: toError(error).message,
        });
      }

      try {
        await server.close();
      } catch (error) {
        log.warn("Failed to close MCP session cleanly", {
          sessionId,
          error: toError(error).message,
        });
      }
    }),
  );
}

async function handlePostRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const sessionId = getSessionId(req);

  if (sessionId) {
    const context = sessions.get(sessionId);

    if (!context) {
      sendJsonRpcError(res, 404, -32001, "Session not found");
      return;
    }

    await context.transport.handleRequest(req, res, body);
    return;
  }

  if (!isInitializePayload(body)) {
    sendJsonRpcError(
      res,
      400,
      -32000,
      "Bad Request: initialization required before using this endpoint",
    );
    return;
  }

  let context: SessionContext | undefined;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      if (!context) {
        return;
      }

      sessions.set(newSessionId, context);
      log.info("Initialized MCP HTTP session", { sessionId: newSessionId });
    },
  });

  transport.onclose = () => {
    const activeSessionId = transport.sessionId;

    if (!activeSessionId) {
      return;
    }

    sessions.delete(activeSessionId);
    log.info("Closed MCP HTTP session", { sessionId: activeSessionId });
  };

  transport.onerror = (error) => {
    log.error("MCP HTTP transport error", { error: toError(error).message });
  };

  context = {
    server: createMcpServer(),
    transport,
  };

  await context.server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleSessionRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    sendText(res, 400, "Missing MCP session ID");
    return;
  }

  const context = sessions.get(sessionId);

  if (!context) {
    sendText(res, 404, "Invalid MCP session ID");
    return;
  }

  await context.transport.handleRequest(req, res);
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname !== MCP_PATH) {
      sendText(res, 404, "Not Found");
      return;
    }

    switch (req.method) {
      case "POST":
        await handlePostRequest(req, res);
        return;
      case "GET":
      case "DELETE":
        await handleSessionRequest(req, res);
        return;
      default:
        res.setHeader("Allow", "GET, POST, DELETE");
        sendText(res, 405, "Method Not Allowed");
    }
  } catch (error) {
    const err = toError(error);

    log.error("Failed to handle HTTP request", {
      method: req.method,
      url: req.url,
      error: err.message,
    });

    if (error instanceof SyntaxError) {
      sendJsonRpcError(res, 400, -32700, "Invalid JSON body");
      return;
    }

    sendJsonRpcError(res, 500, -32603, "Internal server error");
  }
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log.info("Shutting down...", { signal });

  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await closeAllSessions();
  await disconnectPostgres();
}

async function main() {
  const postgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
  const host = getHost();
  const port = getPort();

  log.info("Starting mcp-emission-engineer...");
  await connectPostgres(postgresUrl);

  httpServer = createServer((req, res) => {
    void handleHttpRequest(req, res);
  });

  httpServer.on("clientError", (error, socket) => {
    log.warn("HTTP client error", { error: toError(error).message });
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer?.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      httpServer?.off("error", onError);
      resolve();
    };

    httpServer?.once("error", onError);
    httpServer?.once("listening", onListening);
    httpServer?.listen(port, host);
  });

  log.info("mcp-emission-engineer running on Streamable HTTP", {
    url: `http://${host}:${port}${MCP_PATH}`,
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

main().catch((error) => {
  log.error("Fatal startup error", { error: toError(error).message });
  void shutdown("startup-error").finally(() => process.exit(1));
});
