import { McpError, NotFoundError, UnauthorizedError, ValidationError, toError } from "@mcpkit/utils";

/**
 * Maps a non-2xx response from Voyage Management Service or Reports
 * Agent into an agent-friendly error — same role as `dbErrors.ts` in
 * `mcp-alerts-service`, adapted for HTTP (this package never connects to
 * a database directly, only REST APIs — Plan/mcp-voyage-management-tools-plan.md
 * Section 1).
 */
export function toUpstreamError(status: number, body: unknown, path: string): Error {
  const message = extractMessage(body) ?? `Upstream request to "${path}" failed with status ${status}`;

  if (status === 404) {
    return new NotFoundError(path);
  }
  if (status === 401 || status === 403) {
    return new UnauthorizedError(message);
  }
  if (status === 400 || status === 422) {
    return new ValidationError(message);
  }
  return new McpError("UPSTREAM_ERROR", message, { status, path });
}

/** NestJS's default exception filter shape is `{ statusCode, message, error }` — `message` is a string for most exceptions, an array of strings for a `ValidationPipe` rejection. */
function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join("; ");
  }
  return undefined;
}

export { toError };
