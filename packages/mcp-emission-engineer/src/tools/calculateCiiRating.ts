import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { connectPostgres, createLogger, requireEnv, toError } from "@mcpkit/utils";
import { computeCiiForPeriod } from "../cii/engine.js";
import {
  getTenantPostgresUrl,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:calculate-cii-rating");

export function registerCalculateCiiRatingTool(server: McpServer): void {
  server.tool(
    "calculate_cii_rating",
    "Calculate the attained and required CII plus the A-E rating for a vessel over a date range using tenant noon reports",
    {
      startDate: z
        .string()
        .trim()
        .min(1)
        .describe("Start date in YYYY-MM-DD format"),
      endDate: z
        .string()
        .trim()
        .min(1)
        .describe("End date in YYYY-MM-DD format"),
      vesselId: z
        .string()
        .trim()
        .optional()
        .describe("Internal vessel id from shipping_db.ship.id"),
      imo: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Vessel IMO number from shipping_db.ship.imo"),
      tenant: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Tenant database name"),
    },
    async ({ startDate, endDate, vesselId, imo, tenant }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
      let normalizedVesselId: number | undefined;
      let normalizedTenantName: string | undefined;

      try {
        normalizedVesselId = normalizeVesselId(vesselId);
        normalizedTenantName = resolveTenantName(tenant);
        const tenantPostgresUrl = getTenantPostgresUrl(
          basePostgresUrl,
          normalizedTenantName,
        );
        const pool = await connectPostgres(tenantPostgresUrl);

        const payload = await computeCiiForPeriod(pool, {
          vesselId: normalizedVesselId,
          imo,
          tenantName: normalizedTenantName,
          startDate,
          endDate,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("calculate_cii_rating failed", {
          vesselId: normalizedVesselId,
          imo,
          tenant: normalizedTenantName ?? tenant,
          startDate,
          endDate,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
