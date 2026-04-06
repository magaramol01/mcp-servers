import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  connectPostgres,
  createLogger,
  NotFoundError,
  requireEnv,
  toError,
  ValidationError,
} from "@mcpkit/utils";
import {
  buildCiiDedupedReportsTraceQuery,
  GET_VESSEL_CII_CONTEXT_QUERY,
  resolveTenantFuelConfig,
  toFiniteNumber,
  type CiiFuelConfigEntry,
} from "../cii/engine.js";
import {
  getTenantPostgresUrl,
  normalizeIsoDateInput,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:trace-cii-calculation-inputs");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonNumber(data: Record<string, unknown>, tag: string): number | null {
  const raw = data[tag];

  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  return toFiniteNumber(raw);
}

/** Matches `buildPreferredGroupExpression` / SQL CASE: first tag group with any non-null value wins. */
function preferredGroupSum(data: Record<string, unknown>, tagGroups: string[][]): number {
  for (const group of tagGroups) {
    const values = group.map((tag) => readJsonNumber(data, tag));
    const hasAny = values.some((value) => value !== null);

    if (hasAny) {
      return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }
  }

  return 0;
}

function fuelTotalsForReport(
  noonreportdata: unknown,
  fuelEntries: CiiFuelConfigEntry[],
): Record<string, number> {
  if (!isRecord(noonreportdata)) {
    return {};
  }

  const totals: Record<string, number> = {};

  for (const entry of fuelEntries) {
    totals[entry.type] = preferredGroupSum(noonreportdata, entry.tagGroups);
  }

  return totals;
}

export function registerTraceCiiCalculationInputsTool(server: McpServer): void {
  server.tool(
    "trace_cii_calculation_inputs",
    "Return the deduplicated noon-report rows used for CII (same dedup rules as calculate_cii_rating) with per-report fuel totals derived from tenant fuel config tags.",
    {
      startDate: z.string().trim().min(1).describe("Start date YYYY-MM-DD"),
      endDate: z.string().trim().min(1).describe("End date YYYY-MM-DD"),
      vesselId: z.string().trim().optional().describe("shipping_db.ship.id"),
      imo: z.string().trim().min(1).optional(),
      tenant: z.string().trim().min(1).describe("Tenant database name"),
    },
    async ({ startDate, endDate, vesselId, imo, tenant }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");

      try {
        if (vesselId === undefined && imo === undefined) {
          throw new ValidationError("Provide either vesselId or imo");
        }

        const normalizedVesselId = normalizeVesselId(vesselId);
        const normalizedTenant = resolveTenantName(tenant);
        const normalizedStart = normalizeIsoDateInput("startDate", startDate);
        const normalizedEnd = normalizeIsoDateInput("endDate", endDate);

        if (normalizedStart > normalizedEnd) {
          throw new ValidationError("startDate must be on or before endDate");
        }

        const tenantPostgresUrl = getTenantPostgresUrl(basePostgresUrl, normalizedTenant);
        const pool = await connectPostgres(tenantPostgresUrl);
        const fuelConfig = resolveTenantFuelConfig(normalizedTenant);

        const { rows: vesselRows } = await pool.query(GET_VESSEL_CII_CONTEXT_QUERY, [
          normalizedVesselId ?? null,
          imo ?? null,
        ]);

        const vessel = vesselRows[0] as { id: number } | undefined;

        if (!vessel) {
          throw new NotFoundError(
            "Vessel",
            normalizedVesselId !== undefined ? String(normalizedVesselId) : imo,
          );
        }

        const traceQuery = buildCiiDedupedReportsTraceQuery();
        const { rows } = await pool.query<{
          id: number;
          report_date_time_utc: string;
          reporttype: string;
          canonical_reporttype: string;
          noonreportdata: unknown;
        }>(traceQuery, [vessel.id, normalizedStart, normalizedEnd]);

        const reports = rows.map((row) => ({

          id: row.id,
          report_date_time_utc: row.report_date_time_utc,
          reporttype: row.reporttype,
          canonical_reporttype: row.canonical_reporttype,
          fuel_mt_by_type: fuelTotalsForReport(row.noonreportdata, fuelConfig.entries),
          distance_nm: (() => {
            if (!isRecord(row.noonreportdata)) {
              return null;
            }

            const data = row.noonreportdata;
            return (
              toFiniteNumber(readJsonNumber(data, "Observed_Distance_GPS")) ??
              toFiniteNumber(readJsonNumber(data, "Distance"))
            );
          })(),
          me_running_hrs: isRecord(row.noonreportdata)
            ? toFiniteNumber(readJsonNumber(row.noonreportdata, "ME_Running_Hrs"))
            : null,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  vessel_id: vessel.id,
                  tenant: normalizedTenant,
                  period: { startDate: normalizedStart, endDate: normalizedEnd },
                  deduplication: {
                    rule:
                      "One row per (report_date_time_utc, canonical_reporttype); ASL reports win ties; else highest id.",
                    excluded_reporttypes: ["ABS Bunker Report", "ABS Template"],
                  },
                  fuel_config: {
                    source: fuelConfig.source,
                    fuel_types: fuelConfig.entries.map((entry) => entry.type),
                  },
                  fuel_row_total_mt: reports.reduce(
                    (acc, row) => {
                      for (const [type, mt] of Object.entries(row.fuel_mt_by_type)) {
                        acc[type] = (acc[type] ?? 0) + mt;
                      }

                      return acc;
                    },
                    {} as Record<string, number>,
                  ),
                  report_count: reports.length,
                  reports,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("trace_cii_calculation_inputs failed", {
          vesselId,
          imo,
          tenant,
          startDate,
          endDate,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
