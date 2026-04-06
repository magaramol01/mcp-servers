import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, toError, ValidationError } from "@mcpkit/utils";
import {
  getEuEtsMaritimeCoveragePercent,
  METHODOLOGY_ID_EU_ETS,
} from "../eu/euEtsConstants.js";

const log = createLogger("mcp-emission-engineer:estimate-eu-ets-obligation");

export function registerEstimateEuEtsObligationTool(server: McpServer): void {
  server.tool(
    "estimate_eu_ets_obligation",
    "Indicative EU ETS allowance demand from verified CO₂ (EU/EEA-scope) and the maritime phase-in schedule (40% / 70% / 100% for 2024–2026). 1 EUA ≈ 1 t CO₂. Not a compliance filing.",
    {
      compliance_year: z
        .number()
        .int()
        .min(2024)
        .max(2100)
        .describe("Calendar year for surrender obligation"),
      eu_related_co2_tonnes: z
        .number()
        .nonnegative()
        .optional()
        .describe("Verified CO₂ tonnes in EU ETS maritime scope (already allocated)"),
      total_co2_tonnes: z
        .number()
        .nonnegative()
        .optional()
        .describe("Alternative: total CO₂ before EU split"),
      eu_activity_share_percent: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Alternative: % of activity (or emissions) attributed to EU/EEA when using total_co2_tonnes"),
    },
    async ({ compliance_year, eu_related_co2_tonnes, total_co2_tonnes, eu_activity_share_percent }) => {
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
        const allowance_demand_tonnes_co2 = (euTonnes * coveragePercent) / 100;

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
                  estimated_eua_demand_tonnes_co2_equivalent: allowance_demand_tonnes_co2,
                  notes: [
                    "Demand = EU-scope verified CO₂ × phase-in %; assumes 1 EUA = 1 t CO₂.",
                    "EU/EEA allocation must follow MRV rules (voyages and port calls) — this tool does not allocate scope.",
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
        log.error("estimate_eu_ets_obligation failed", { error: error.message });
        throw error;
      }
    },
  );
}
