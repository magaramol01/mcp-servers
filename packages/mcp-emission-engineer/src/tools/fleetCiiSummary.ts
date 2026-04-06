import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  connectPostgres,
  createLogger,
  requireEnv,
  toError,
  ValidationError,
} from "@mcpkit/utils";
import {
  computeCiiForPeriod,
  LIST_FLEET_VESSELS_QUERY,
  type FleetVesselRow,
} from "../cii/engine.js";
import { getTenantPostgresUrl, resolveTenantName } from "./shared.js";

const log = createLogger("mcp-emission-engineer:fleet-cii-summary");

const LIST_FLEET_VESSELS_FILTERED_QUERY = `
  SELECT
    s.id,
    s.name,
    s.imo,
    s.category,
    s.deadweight::double precision AS deadweight
  FROM shipping_db.ship AS s
  WHERE ($1::integer[] IS NULL OR s.id = ANY($1))
  ORDER BY s.id ASC
`;

type CiiPayload = {
  vessel: { id: number; name: string | null; imo: string | null; category: string };
  cii: {
    calculation_status: string;
    cii_rating: string | null;
    attained_over_required_ratio: number | null;
    cii_percentage: number | null;
    required_cii: number | null;
    attained_cii: number | null;
  };
};

function isCiiPayload(value: unknown): value is CiiPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const v = value as Record<string, unknown>;
  const cii = v.cii;

  return typeof v.vessel === "object" && v.vessel !== null && typeof cii === "object" && cii !== null;
}

function complianceFlag(payload: CiiPayload): "ok" | "watch" | "non_compliant" | "unknown" {
  const status = payload.cii.calculation_status;

  if (status !== "calculated") {
    return "unknown";
  }

  const rating = payload.cii.cii_rating;

  if (rating === "D" || rating === "E") {
    return "non_compliant";
  }

  if (rating === "C") {
    return "watch";
  }

  return "ok";
}

export function registerFleetCiiSummaryTool(server: McpServer): void {
  server.tool(
    "fleet_cii_summary",
    "Run the same CII calculation as calculate_cii_rating for many vessels in a tenant (same calendar year window). Returns per-vessel rating and a simple compliance flag.",
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
      tenant: z.string().trim().min(1).describe("Tenant database name"),
      vesselIds: z
        .array(z.string().trim().regex(/^\d+$/))
        .optional()
        .describe("Optional list of shipping_db.ship.id values to include"),
      maxVessels: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Safety cap on vessels processed (default 200)"),
    },
    async ({ startDate, endDate, tenant, vesselIds, maxVessels }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
      const normalizedTenant = resolveTenantName(tenant);
      const cap = maxVessels ?? 200;

      try {
        const tenantPostgresUrl = getTenantPostgresUrl(basePostgresUrl, normalizedTenant);
        const pool = await connectPostgres(tenantPostgresUrl);

        const idFilter =
          vesselIds !== undefined && vesselIds.length > 0
            ? vesselIds.map((id) => Number.parseInt(id, 10))
            : null;

        if (idFilter?.some((id) => Number.isNaN(id) || id <= 0)) {
          throw new ValidationError("vesselIds must be positive integers");
        }

        const listQuery =
          idFilter !== null ? LIST_FLEET_VESSELS_FILTERED_QUERY : LIST_FLEET_VESSELS_QUERY;
        const listParams = idFilter !== null ? [idFilter] : [];

        const { rows: vesselRows } = await pool.query<FleetVesselRow>(listQuery, listParams);

        const limitedRows = vesselRows.slice(0, cap);
        const truncated = vesselRows.length > cap;

        const items: unknown[] = [];

        for (const row of limitedRows) {
          try {
            const payload = await computeCiiForPeriod(pool, {
              vesselId: row.id,
              tenantName: normalizedTenant,
              startDate,
              endDate,
            });

            if (!isCiiPayload(payload)) {
              items.push({
                vessel_id: row.id,
                name: row.name ?? null,
                imo: row.imo ?? null,
                raw_category: row.category ?? null,
                status: "error",
                error: "Unexpected CII payload shape",
              });
              continue;
            }

            items.push({
              vessel_id: row.id,
              name: row.name ?? null,
              imo: row.imo ?? null,
              raw_category: row.category ?? null,
              category: payload.vessel.category,
              cii_rating: payload.cii.cii_rating,
              calculation_status: payload.cii.calculation_status,
              attained_over_required_ratio: payload.cii.attained_over_required_ratio,
              cii_percentage: payload.cii.cii_percentage,
              required_cii: payload.cii.required_cii,
              attained_cii: payload.cii.attained_cii,
              compliance_flag: complianceFlag(payload),
            });
          } catch (error) {
            const err = toError(error);

            if (err instanceof ValidationError && err.message.includes("Unsupported ship category")) {
              items.push({
                vessel_id: row.id,
                name: row.name ?? null,
                imo: row.imo ?? null,
                raw_category: row.category ?? null,
                status: "skipped",
                reason: err.message,
              });
              continue;
            }

            items.push({
              vessel_id: row.id,
              name: row.name ?? null,
              imo: row.imo ?? null,
              raw_category: row.category ?? null,
              status: "error",
              error: err.message,
            });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tenant: normalizedTenant,
                  period: { startDate, endDate },
                  fleet: {
                    vessel_count_in_db: vesselRows.length,
                    vessel_count_processed: limitedRows.length,
                    truncated,
                    cap,
                  },
                  items,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("fleet_cii_summary failed", {
          tenant: normalizedTenant,
          startDate,
          endDate,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
