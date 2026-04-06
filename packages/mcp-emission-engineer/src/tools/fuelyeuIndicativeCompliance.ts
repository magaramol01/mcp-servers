import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, toError, ValidationError } from "@mcpkit/utils";
import {
  FUEL_EU_REFERENCE_INTENSITY_GCO2E_PER_MJ_2020,
  METHODOLOGY_ID_EU_FUEL_EU,
  requiredFuelEuIntensityGco2ePerMj,
} from "../eu/fuelEuConstants.js";

const log = createLogger("mcp-emission-engineer:fueleu-indicative-compliance");

export function registerFuelyeuIndicativeComplianceTool(server: McpServer): void {
  server.tool(
    "fuelyeu_indicative_compliance",
    "Compare attained yearly average GHG intensity (g CO₂e/MJ, well-to-wake) to indicative FuelEU limits from Regulation (EU) 2023/1805 schedule. For planning — verify energy and intensities against verified MRV data.",
    {
      reporting_year: z.number().int().min(2025).max(2100),
      attained_intensity_gco2e_per_mj: z.number().positive().optional(),
      total_energy_mj: z.number().positive().optional(),
      total_ghg_gco2e: z.number().nonnegative().optional(),
    },
    async ({ reporting_year, attained_intensity_gco2e_per_mj, total_energy_mj, total_ghg_gco2e }) => {
      try {
        let attained: number;

        if (attained_intensity_gco2e_per_mj !== undefined) {
          attained = attained_intensity_gco2e_per_mj;
        } else if (total_energy_mj !== undefined && total_ghg_gco2e !== undefined) {
          attained = total_ghg_gco2e / total_energy_mj;
        } else {
          throw new ValidationError(
            "Provide attained_intensity_gco2e_per_mj or both total_energy_mj and total_ghg_gco2e",
          );
        }

        const required = requiredFuelEuIntensityGco2ePerMj(reporting_year);
        const margin = required - attained;
        const baseline = FUEL_EU_REFERENCE_INTENSITY_GCO2E_PER_MJ_2020;
        const reduction_vs_2020_percent = ((baseline - attained) / baseline) * 100;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  methodology_id: METHODOLOGY_ID_EU_FUEL_EU,
                  reporting_year,
                  reference_intensity_2020_gco2e_per_mj: baseline,
                  required_max_intensity_gco2e_per_mj: required,
                  attained_intensity_gco2e_per_mj: attained,
                  margin_to_limit_gco2e_per_mj: margin,
                  reduction_vs_2020_reference_percent: reduction_vs_2020_percent,
                  indicative_status:
                    attained <= required ? "at_or_below_required_intensity" : "above_required_intensity",
                  notes: [
                    "Required intensity uses interpolated reduction schedule vs 2020 reference — confirm against delegated acts for the reporting year.",
                    "Penalties and pooling are not calculated here.",
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
        log.error("fuelyeu_indicative_compliance failed", { error: error.message });
        throw error;
      }
    },
  );
}
