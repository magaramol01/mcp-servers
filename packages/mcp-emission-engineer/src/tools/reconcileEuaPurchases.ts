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
  getEuEtsMaritimeCoveragePercent,
  METHODOLOGY_ID_EU_ETS,
} from "../eu/euEtsConstants.js";
import { GET_VESSEL_CII_CONTEXT_QUERY } from "../cii/engine.js";
import {
  getTenantPostgresUrl,
  normalizeVesselId,
  resolveTenantName,
} from "./shared.js";

const log = createLogger("mcp-emission-engineer:reconcile-eua-purchases");

/** Optional ledger: create in DB with these columns when using include_ledger_if_available. */
const EUA_LEDGER_TABLE = "shipping_db.eua_allowance_ledger";

export function registerReconcileEuaPurchasesTool(server: McpServer): void {
  server.tool(
    "reconcile_eua_purchases",
    "Compare indicative EU ETS allowance demand (phase-in × EU-scope CO₂) to allowances recorded (manual input and/or optional shipping_db.eua_allowance ledger sum).",
    {
      compliance_year: z.number().int().min(2024).max(2100),
      eu_related_co2_tonnes: z.number().nonnegative().optional(),
      total_co2_tonnes: z.number().nonnegative().optional(),
      eu_activity_share_percent: z.number().min(0).max(100).optional(),
      allowances_position_tonnes_co2: z
        .number()
        .nonnegative()
        .optional()
        .describe("EUAs available for surrender, t CO₂ equivalent (manual)"),
      include_ledger_if_available: z
        .boolean()
        .optional()
        .describe(
          `If true, sum column tonnes_co2_equivalent from ${EUA_LEDGER_TABLE} for the vessel (ignored if table missing)`,
        ),
      vesselId: z.string().trim().optional(),
      imo: z.string().trim().min(1).optional(),
      tenant: z.string().trim().min(1).optional(),
    },
    async ({
      compliance_year,
      eu_related_co2_tonnes,
      total_co2_tonnes,
      eu_activity_share_percent,
      allowances_position_tonnes_co2,
      include_ledger_if_available,
      vesselId,
      imo,
      tenant,
    }) => {
      const basePostgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");

      try {
        let euTonnes: number;

        if (eu_related_co2_tonnes !== undefined) {
          euTonnes = eu_related_co2_tonnes;
        } else if (total_co2_tonnes !== undefined && eu_activity_share_percent !== undefined) {
          euTonnes = (total_co2_tonnes * eu_activity_share_percent) / 100;
        } else {
          throw new ValidationError(
            "Provide either eu_related_co2_tonnes or both total_co2_tonnes and eu_activity_share_percent",
          );
        }

        const coveragePercent = getEuEtsMaritimeCoveragePercent(compliance_year);
        const required_allowances_tonnes = (euTonnes * coveragePercent) / 100;

        let ledgerSum: number | null = null;
        let ledger_status: "skipped" | "ok" | "unavailable" = "skipped";

        if (include_ledger_if_available && (vesselId !== undefined || imo !== undefined) && tenant) {
          const normalizedVesselId = normalizeVesselId(vesselId);
          const normalizedTenant = resolveTenantName(tenant);
          const tenantPostgresUrl = getTenantPostgresUrl(basePostgresUrl, normalizedTenant);
          const pool = await connectPostgres(tenantPostgresUrl);

          const { rows: vesselRows } = await pool.query<{ id: number }>(GET_VESSEL_CII_CONTEXT_QUERY, [
            normalizedVesselId ?? null,
            imo ?? null,
          ]);
          const vessel = vesselRows[0];

          if (!vessel) {
            throw new NotFoundError(
              "Vessel",
              normalizedVesselId !== undefined ? String(normalizedVesselId) : imo,
            );
          }

          try {
            const { rows } = await pool.query<{ s: string | number }>(
              `SELECT COALESCE(SUM(tonnes_co2_equivalent), 0)::double precision AS s
               FROM ${EUA_LEDGER_TABLE}
               WHERE vessel_id = $1`,
              [vessel.id],
            );
            ledgerSum = Number(rows[0]?.s ?? 0);
            ledger_status = "ok";
          } catch {
            ledger_status = "unavailable";
          }
        } else if (include_ledger_if_available) {
          ledger_status = "skipped";
        }

        const manual = allowances_position_tonnes_co2 ?? 0;
        const fromLedger = ledgerSum ?? 0;
        const combinedPosition = manual + (ledger_status === "ok" ? fromLedger : 0);
        const gap_tonnes = required_allowances_tonnes - combinedPosition;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  methodology_id: METHODOLOGY_ID_EU_ETS,
                  compliance_year,
                  phase_in_coverage_percent: coveragePercent,
                  eu_related_co2_tonnes: euTonnes,
                  required_allowances_tonnes_co2_equivalent: required_allowances_tonnes,
                  allowances_manual_tonnes: manual,
                  allowances_ledger_sum_tonnes: ledgerSum,
                  ledger_table: EUA_LEDGER_TABLE,
                  ledger_status,
                  combined_allowances_position_tonnes: combinedPosition,
                  gap_tonnes_co2_equivalent: gap_tonnes,
                  interpretation:
                    gap_tonnes > 0.001
                      ? "short_vs_demand"
                      : gap_tonnes < -0.001
                        ? "surplus_vs_demand"
                        : "aligned",
                  notes: [
                    "Ledger requires table shipping_db.eua_allowance_ledger with columns vessel_id, tonnes_co2_equivalent.",
                    "Do not double-count manual input and ledger if both describe the same EUAs.",
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("reconcile_eua_purchases failed", { error: error.message });
        throw error;
      }
    },
  );
}
