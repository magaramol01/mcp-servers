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
import { toAgentFriendlyDbError } from "../dbErrors.js";
import { emissionsFromMassByFuelType, METHODOLOGY_ID } from "../accounting/ipccFactors.js";
import {
  fuelTotalsForReport,
  mergeFuelMaps,
  reportDistanceNm,
  reportMeRunningHrs,
} from "../accounting/fuelFromReports.js";
import { segmentVoyages } from "../accounting/voyageSegments.js";
import {
  buildCiiDedupedReportsTraceQuery,
  GET_VESSEL_CII_CONTEXT_QUERY,
  resolveTenantFuelConfig,
} from "../cii/engine.js";
import {
  getTenantPostgresUrl,
  normalizeIsoDateInput,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:aggregate-emissions-by-voyage");

export function registerAggregateEmissionsByVoyageTool(server: McpServer): void {
  server.tool(
    "aggregate_emissions_by_voyage",
    "Sum fuel from deduplicated noon reports per voyage (BOSP→EOSP) or as a single period, then apply the same CO₂/CO₂e model as calculate_emissions_from_fuel.",
    {
      startDate: z
        .string()
        .trim()
        .min(1)
        .describe("Start date YYYY-MM-DD"),
      endDate: z
        .string()
        .trim()
        .min(1)
        .describe("End date YYYY-MM-DD"),
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
        .describe("Tenant database name (PostgreSQL database name)"),
      voyage_mode: z
        .enum(["bosp_eosp", "period_single"])
        .optional()
        .describe(
          "bosp_eosp: sea passages from BOSP through EOSP; period_single: entire period as one voyage",
        ),
    },
    async ({ startDate, endDate, vesselId, imo, tenant, voyage_mode }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
      const mode = voyage_mode ?? "bosp_eosp";

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

        const segmentResult = segmentVoyages(rows, mode);

        const buildVoyagePayload = (
          voyageIndex: number | null,
          reportRows: typeof rows,
          incomplete: boolean,
        ) => {
          const fuel_mt_by_type: Record<string, number> = {};
          let distance_nm = 0;
          let me_running_hours = 0;

          for (const r of reportRows) {
            mergeFuelMaps(fuel_mt_by_type, fuelTotalsForReport(r.noonreportdata, fuelConfig.entries));
            distance_nm += reportDistanceNm(r.noonreportdata) ?? 0;
            me_running_hours += reportMeRunningHrs(r.noonreportdata) ?? 0;
          }

          let emissions;

          try {
            emissions = emissionsFromMassByFuelType(fuel_mt_by_type);
          } catch (error) {
            emissions = {
              error: toError(error).message,
            };
          }

          return {
            voyage_index: voyageIndex,
            segment: voyageIndex === null ? "prelude_before_first_bosp" : "voyage",
            incomplete,
            report_ids: reportRows.map((r) => r.id),
            report_count: reportRows.length,
            fuel_mt_by_type,
            distance_nm,
            me_running_hours,
            emissions,
          };
        };

        const preludePayload =
          segmentResult.prelude_reports.length > 0
            ? buildVoyagePayload(null, segmentResult.prelude_reports, true)
            : null;

        const voyages = segmentResult.voyages.map((v) =>
          buildVoyagePayload(v.voyage_index, v.reports, v.incomplete),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  methodology_id: METHODOLOGY_ID,
                  vessel_id: vessel.id,
                  tenant: normalizedTenant,
                  period: { startDate: normalizedStart, endDate: normalizedEnd },
                  voyage_mode: mode,
                  segmentation: {
                    no_bosp_in_period: segmentResult.no_bosp_in_period,
                    prelude_report_count: segmentResult.prelude_reports.length,
                  },
                  fuel_config_source: fuelConfig.source,
                  prelude_before_first_bosp: preludePayload,
                  voyage_count: voyages.length,
                  voyages,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toAgentFriendlyDbError(err);
        log.error("aggregate_emissions_by_voyage failed", { error: error.message });
        throw error;
      }
    },
  );
}
