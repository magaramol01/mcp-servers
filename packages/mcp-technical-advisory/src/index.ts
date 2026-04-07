import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createLogger, requireEnv, toError } from "@mcpkit/utils";
import { TechnicalAdvisoryRag } from "./rag.js";
import { createMcpServer } from "./server.js";

const log = createLogger("mcp-technical-advisory");
const packageEnvPath = resolve(__dirname, "../.env");
const defaultServiceAccountPath = resolve(
  __dirname,
  "../key/ssh-marine-5047e738d9ee.json",
);
const MCP_PATH = "/mcp";
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;

if (existsSync(packageEnvPath)) {
  process.loadEnvFile(packageEnvPath);
}

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
};

// MCP sessions are kept in memory for the lifetime of this process.
const sessions = new Map<string, SessionContext>();
let httpServer: ReturnType<typeof createServer> | null = null;
let isShuttingDown = false;
let ragService: TechnicalAdvisoryRag | null = null;

type GcsLocationConfig = {
  bucketName: string;
  defaultPrefix?: string;
  includesEmbeddedPrefix: boolean;
};

/**
 * Resolves the host interface for the HTTP server.
 *
 * @returns Hostname or IP address to bind the MCP server to.
 */
function getHost(): string {
  return process.env.TECHNICAL_ADVISORY_HOST ?? process.env.HOST ?? DEFAULT_HOST;
}

/**
 * Resolves and validates the TCP port used by the HTTP server.
 *
 * @returns Numeric port between 1 and 65535.
 * @throws Error When the configured port is invalid.
 */
function getPort(): number {
  const rawPort =
    process.env.TECHNICAL_ADVISORY_PORT ?? process.env.PORT ?? String(DEFAULT_PORT);
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }

  return port;
}

/**
 * Resolves the Google credentials file path used by the GCS client.
 * An explicit environment variable wins; otherwise the repo-local fallback key
 * is used when present.
 *
 * @returns Absolute credentials path or `undefined` to rely on ambient auth.
 */
function resolveGoogleApplicationCredentials(): string | undefined {
  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  if (existsSync(defaultServiceAccountPath)) {
    return defaultServiceAccountPath;
  }

  return undefined;
}

/**
 * Normalizes an optional GCS prefix so leading slashes are stripped and empty
 * strings are treated as absent.
 *
 * @param prefix Optional prefix value from env or parsed bucket path.
 * @returns Normalized prefix or `undefined`.
 */
function normalizeGcsPrefix(prefix?: string): string | undefined {
  const normalizedPrefix = prefix?.trim().replace(/^\/+/, "");
  return normalizedPrefix ? normalizedPrefix : undefined;
}

/**
 * Accepts either a plain bucket name or a `gs://bucket/prefix` style value and
 * converts it into the bucket + default prefix pair used internally.
 *
 * @param rawBucketReference Configured GCS bucket reference.
 * @param configuredPrefix Optional explicit prefix override from env.
 * @returns Parsed bucket configuration for the RAG service.
 */
function resolveGcsLocationConfig(
  rawBucketReference: string,
  configuredPrefix?: string,
): GcsLocationConfig {
  const normalizedReference = rawBucketReference.trim().replace(/^gs:\/\//, "");

  if (!normalizedReference) {
    throw new Error("GCS_BUCKET_NAME must not be empty");
  }

  const separatorIndex = normalizedReference.indexOf("/");
  const bucketName =
    separatorIndex === -1
      ? normalizedReference
      : normalizedReference.slice(0, separatorIndex);
  const embeddedPrefix =
    separatorIndex === -1 ? undefined : normalizedReference.slice(separatorIndex + 1);

  if (!bucketName) {
    throw new Error(`Invalid GCS bucket reference: ${rawBucketReference}`);
  }

  return {
    bucketName,
    defaultPrefix: normalizeGcsPrefix(configuredPrefix) ?? normalizeGcsPrefix(embeddedPrefix),
    includesEmbeddedPrefix: separatorIndex !== -1,
  };
}

/**
 * Extracts the current MCP session id from request headers.
 *
 * @param req Incoming HTTP request.
 * @returns Session id when present.
 */
function getSessionId(req: IncomingMessage): string | undefined {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Detects whether a request body contains an MCP initialize request.
 *
 * @param body Parsed JSON request body.
 * @returns `true` when the payload initializes a new MCP session.
 */
function isInitializePayload(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((message) => isInitializeRequest(message));
  }

  return isInitializeRequest(body);
}

/**
 * Reads and parses the JSON body for an incoming HTTP request.
 *
 * @param req Incoming HTTP request.
 * @returns Parsed JSON payload or `undefined` when the body is empty.
 */
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

/**
 * Sends a plain JSON response when the transport does not already own the socket.
 *
 * @param res HTTP response object.
 * @param statusCode HTTP status code to send.
 * @param payload Serializable JSON payload.
 */
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

/**
 * Sends a JSON-RPC error response for transport-level failures.
 *
 * @param res HTTP response object.
 * @param statusCode HTTP status code to send.
 * @param code JSON-RPC error code.
 * @param message Human-readable error message.
 */
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

/**
 * Sends a plain-text response for simple HTTP error cases.
 *
 * @param res HTTP response object.
 * @param statusCode HTTP status code to send.
 * @param message Response text.
 */
function sendText(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

/**
 * Closes every active MCP session during shutdown.
 *
 * @returns Promise that resolves once all transports and server instances close.
 */
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

/**
 * Handles POST requests to `/mcp`, either routing an existing session request
 * or initializing a brand-new MCP session.
 *
 * @param req Incoming HTTP request.
 * @param res Outgoing HTTP response.
 */
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

  if (!ragService) {
    throw new Error("Technical advisory RAG service is not initialized");
  }

  let context: SessionContext | undefined;

  // Each initialized MCP session gets its own transport and server instance.
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
    server: createMcpServer(ragService),
    transport,
  };

  await context.server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/**
 * Handles GET and DELETE requests for an existing MCP session.
 *
 * @param req Incoming HTTP request.
 * @param res Outgoing HTTP response.
 */
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

/**
 * Top-level HTTP router for the Streamable HTTP MCP endpoint.
 *
 * @param req Incoming HTTP request.
 * @param res Outgoing HTTP response.
 */
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

/**
 * Stops the HTTP server and tears down all active MCP sessions.
 *
 * @param signal Human-readable shutdown trigger used for logging.
 */
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
}

/**
 * Bootstraps configuration, constructs the shared RAG service, and starts the
 * Streamable HTTP MCP server.
 */
async function main(): Promise<void> {
  const pageIndexApiKey = requireEnv("PAGEINDEX_API_KEY");
  const rawGcsBucketName = requireEnv("GCS_BUCKET_NAME");
  const gcsLocation = resolveGcsLocationConfig(
    rawGcsBucketName,
    process.env.TECHNICAL_ADVISORY_GCS_PREFIX,
  );
  const googleApplicationCredentials = resolveGoogleApplicationCredentials();
  const host = getHost();
  const port = getPort();

  if (gcsLocation.includesEmbeddedPrefix) {
    log.warn(
      "GCS_BUCKET_NAME included a path. Using the bucket portion and treating the rest as the default prefix.",
      {
        bucketName: gcsLocation.bucketName,
        defaultPrefix: gcsLocation.defaultPrefix ?? null,
      },
    );
  }

  if (gcsLocation.defaultPrefix) {
    log.info("Using default GCS document prefix", {
      prefix: gcsLocation.defaultPrefix,
    });
  }

  if (googleApplicationCredentials) {
    log.info("Using Google Cloud credentials file", {
      path: googleApplicationCredentials,
    });
  } else {
    log.warn(
      "No Google Cloud credentials file configured. The server will rely on ambient Google credentials.",
    );
  }

  ragService = new TechnicalAdvisoryRag({
    pageIndexApiKey,
    gcsBucketName: gcsLocation.bucketName,
    defaultGcsPrefix: gcsLocation.defaultPrefix,
    googleApplicationCredentials,
  });

  log.info("Starting mcp-technical-advisory...");

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

  log.info("mcp-technical-advisory running on Streamable HTTP", {
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
