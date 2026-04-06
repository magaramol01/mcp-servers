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
import { GET_VESSEL_CII_CONTEXT_QUERY } from "../cii/engine.js";
import { LIST_REPORTS_FOR_VALIDATION } from "../mrv/reportQueries.js";
import {
  getTenantPostgresUrl,
  normalizeIsoDateInput,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:validate-noon-report-series");

type ReportRow = {
  id: number;
  report_date_time_utc: string;
  reporttype: string;
  canonical_reporttype: string;
  distance_nm: number | null;
};

function parseReportTime(value: string): number {
  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return Number.NaN;
  }

  return parsed;
}

export function registerValidateNoonReportSeriesTool(server: McpServer): void {
  server.tool(
    "validate_noon_report_series",
    "List noon reports for a vessel in a date range and flag duplicate timestamps/types, large time gaps, and rows with zero sailed distance.",
    {
      startDate: z.string().trim().min(1).describe("Start date YYYY-MM-DD"),
      endDate: z.string().trim().min(1).describe("End date YYYY-MM-DD"),
      vesselId: z.string().trim().optional().describe("shipping_db.ship.id"),
      imo: z.string().trim().min(1).optional(),
      tenant: z.string().trim().min(1).describe("Tenant database name"),
      gapThresholdHours: z
        .number()
        .positive()
        .optional()
        .describe("Flag consecutive-report gaps exceeding this many hours (default 72)"),
    },
    async ({ startDate, endDate, vesselId, imo, tenant, gapThresholdHours }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
      const thresholdMs = (gapThresholdHours ?? 72) * 60 * 60 * 1000;

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

        const { rows: vesselRows } = await pool.query<{ id: number }>(
          GET_VESSEL_CII_CONTEXT_QUERY,
          [normalizedVesselId ?? null, imo ?? null],
        );

        const vessel = vesselRows[0];

        if (!vessel) {
          throw new NotFoundError(
            "Vessel",
            normalizedVesselId !== undefined ? String(normalizedVesselId) : imo,
          );
        }

        const { rows } = await pool.query<ReportRow>(LIST_REPORTS_FOR_VALIDATION, [
          vessel.id,
          normalizedStart,
          normalizedEnd,
        ]);

        const duplicateGroups = new Map<string, ReportRow[]>();

        for (const row of rows) {
          const key = `${row.report_date_time_utc}\u0000${row.canonical_reporttype}`;
          const existing = duplicateGroups.get(key);

          if (existing) {
            existing.push(row);
          } else {
            duplicateGroups.set(key, [row]);
          }
        }

        const duplicate_timestamp_types = Array.from(duplicateGroups.values())
          .filter((group) => group.length > 1)
          .map((group) => ({
            report_date_time_utc: group[0]?.report_date_time_utc ?? null,
            canonical_reporttype: group[0]?.canonical_reporttype ?? null,
            report_ids: group.map((r) => r.id),
          }));

        const large_gaps: Array<{
          from_report_id: number;
          to_report_id: number;
          gap_hours: number;
        }> = [];

        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1];
          const curr = rows[i];

          if (!prev || !curr) {
            continue;
          }

          const prevMs = parseReportTime(prev.report_date_time_utc);
          const currMs = parseReportTime(curr.report_date_time_utc);

          if (Number.isNaN(prevMs) || Number.isNaN(currMs)) {
            continue;
          }

          const gap = currMs - prevMs;

          if (gap > thresholdMs) {
            large_gaps.push({
              from_report_id: prev.id,
              to_report_id: curr.id,
              gap_hours: Math.round((gap / (60 * 60 * 1000)) * 100) / 100,
            });
          }
        }

        const zero_distance_reports = rows
          .filter((row) => (row.distance_nm ?? 0) <= 0)
          .map((row) => ({
            id: row.id,
            report_date_time_utc: row.report_date_time_utc,
            canonical_reporttype: row.canonical_reporttype,
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
                  summary: {
                    report_row_count: rows.length,
                    duplicate_group_count: duplicate_timestamp_types.length,
                    large_gap_count: large_gaps.length,
                    zero_distance_row_count: zero_distance_reports.length,
                  },
                  duplicate_timestamp_types,
                  large_gaps,
                  zero_distance_reports,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("validate_noon_report_series failed", {
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
