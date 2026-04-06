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
import { buildMrvAuditBundle } from "../mrv/buildAuditBundle.js";
import { GET_VESSEL_CII_CONTEXT_QUERY } from "../cii/engine.js";
import {
  getTenantPostgresUrl,
  normalizeIsoDateInput,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:export-mrv-audit-bundle");

export function registerExportMrvAuditBundleTool(server: McpServer): void {
  server.tool(
    "export_mrv_audit_bundle",
    "Build one JSON package: CII result, deduped vs raw noon counts, duplicate key count, period fuel/emissions totals, and BOSP/EOSP voyage counts — for internal or verifier review (not a THETIS upload). startDate/endDate must fall in one calendar year (CII engine constraint).",
    {
      startDate: z.string().trim().min(1),
      endDate: z.string().trim().min(1),
      vesselId: z.string().trim().optional(),
      imo: z.string().trim().min(1).optional(),
      tenant: z.string().trim().min(1),
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

        const { rows: vesselRows } = await pool.query(GET_VESSEL_CII_CONTEXT_QUERY, [
          normalizedVesselId ?? null,
          imo ?? null,
        ]);

        if (!vesselRows[0]) {
          throw new NotFoundError(
            "Vessel",
            normalizedVesselId !== undefined ? String(normalizedVesselId) : imo,
          );
        }

        const bundle = await buildMrvAuditBundle(pool, {
          vesselId: normalizedVesselId,
          imo,
          tenantName: normalizedTenant,
          startDate: normalizedStart,
          endDate: normalizedEnd,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(bundle, null, 2),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("export_mrv_audit_bundle failed", { error: error.message });
        throw error;
      }
    },
  );
}
