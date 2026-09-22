import { toUpstreamError } from "../httpErrors.js";
import type { Actor } from "./types.js";

export interface InternalServiceClientConfig {
  /** e.g. `http://localhost:8082` — no trailing slash needed. */
  baseUrl: string;
  /** This package's own `x-internal-gateway-key` for this downstream service (Plan/mcp-voyage-management-tools-plan.md Section 1/4 — a distinct key per downstream, not reused from Voyage Agent's own). */
  gatewayKey: string;
  timeoutMs?: number;
}

type QueryValue = string | number | boolean | undefined | null;

/**
 * Thin HTTP client shared by every downstream client in this package
 * (`voyageManagementClient.ts`, `reportsAgentClient.ts`) — sets the same
 * trusted internal headers every VPM 2.0 service expects
 * (`x-internal-gateway-key` + `x-user-*`/`x-company-name`), same trust
 * model as every other internal caller in this system. Never a direct
 * database connection (Plan/mcp-voyage-management-tools-plan.md Section 1
 * — "Data access" convention).
 */
export class InternalServiceClient {
  constructor(private readonly config: InternalServiceClientConfig) {}

  async get<T>(path: string, actor: Actor, query?: Record<string, QueryValue>): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.send<T>("GET", url, actor);
  }

  async post<T>(path: string, actor: Actor, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.send<T>("POST", url, actor, body);
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): URL {
    const url = new URL(path, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }

  private headersFor(actor: Actor): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-internal-gateway-key": this.config.gatewayKey,
      "x-user-id": actor.userId,
      "x-user-email": actor.email,
      "x-user-role": actor.role,
      "x-company-name": actor.companyName,
    };
  }

  private async send<T>(method: "GET" | "POST", url: URL, actor: Actor, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15000);

    try {
      const response = await fetch(url, {
        method,
        headers: this.headersFor(actor),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : undefined;

      if (!response.ok) {
        throw toUpstreamError(response.status, data, url.pathname);
      }

      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
