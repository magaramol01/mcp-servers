import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, toError } from "@mcpkit/utils";
import { METHODOLOGY_ID } from "../accounting/ipccFactors.js";

const log = createLogger("mcp-emission-engineer:classify-emissions-by-scope");

export function registerClassifyEmissionsByScopeTool(server: McpServer): void {
  server.tool(
    "classify_emissions_by_scope",
    "Split or extend reported CO₂e into GHG Protocol style buckets: Scope 1 (ship combustion), Scope 2 (optional shore power), Scope 3 (optional well-to-wake chain uplift on Scope 1). Numbers are indicative; boundary rules depend on your inventory protocol.",
    {
      scope1_co2e_tonnes: z
        .number()
        .nonnegative()
        .describe("Tank-to-wake CO₂e from onboard fuel (t CO₂e)"),
      shore_power_kwh: z
        .number()
        .nonnegative()
        .optional()
        .describe("Shore electricity use in kWh (if tracked separately)"),
      grid_kg_co2_per_kwh: z
        .number()
        .positive()
        .optional()
        .describe("Location-based grid factor for Scope 2 (kg CO₂/kWh). Default 0.45"),
      well_to_wake_increment_percent: z
        .number()
        .min(0)
        .max(200)
        .optional()
        .describe(
          "Optional Scope 3 WTW chain uplift as percent of Scope 1 CO₂e (e.g. 15 = add 15% of scope1 to Scope 3)",
        ),
    },
    async ({
      scope1_co2e_tonnes,
      shore_power_kwh,
      grid_kg_co2_per_kwh,
      well_to_wake_increment_percent,
    }) => {
      try {
        const grid = grid_kg_co2_per_kwh ?? 0.45;
        const kwh = shore_power_kwh ?? 0;
        const scope2_co2e_tonnes = (kwh * grid) / 1000;
        const pct = well_to_wake_increment_percent ?? 0;
        const scope3_wtw_co2e_tonnes = (scope1_co2e_tonnes * pct) / 100;
        const total_co2e_tonnes = scope1_co2e_tonnes + scope2_co2e_tonnes + scope3_wtw_co2e_tonnes;

        const payload = {
          methodology_id: METHODOLOGY_ID,
          scopes: {
            scope1_onboard_combustion_co2e_tonnes: scope1_co2e_tonnes,
            scope2_shore_power_co2e_tonnes: scope2_co2e_tonnes,
            scope3_well_to_wake_chain_uplift_co2e_tonnes: scope3_wtw_co2e_tonnes,
            total_co2e_tonnes,
          },
          inputs: {
            shore_power_kwh: kwh,
            grid_kg_co2_per_kwh: grid,
            well_to_wake_increment_percent: pct,
          },
          assumptions: [
            "Scope 1: supplied by caller (typically tank-to-wake CO₂e from ship fuels).",
            "Scope 2: shore power × grid kg CO₂/kWh → t CO₂e (location-based; not market-based).",
            "Scope 3: optional % uplift on Scope 1 CO₂e to approximate well-to-wake chain emissions — not a full LCA.",
          ],
        };

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
        log.error("classify_emissions_by_scope failed", { error: error.message });
        throw error;
      }
    },
  );
}
