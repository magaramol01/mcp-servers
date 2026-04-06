import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, toError } from "@mcpkit/utils";
import { emissionsFromFuelMasses, KNOWN_FUEL_CANONICAL_KEYS } from "../accounting/ipccFactors.js";

const log = createLogger("mcp-emission-engineer:calculate-emissions-from-fuel");

export function registerCalculateEmissionsFromFuelTool(server: McpServer): void {
  server.tool(
    "calculate_emissions_from_fuel",
    "Estimate CO₂ and CO₂e (CH₄/N₂O with AR5 GWP₁₀₀) from fuel masses using IMO CO₂ factors and IPCC Tier 1 non-CO₂ factors. Does not replace verified MRV submissions.",
    {
      fuels: z
        .array(
          z.object({
            fuel_type: z
              .string()
              .trim()
              .min(1)
              .describe(
                `Fuel key — canonical types: ${KNOWN_FUEL_CANONICAL_KEYS.join(", ")}. Common aliases are accepted (e.g. hsfo→hfo, mdo→mgo, uls→ulsgo, lpg→lpg_propane).`,
              ),
            mass_mt: z
              .number()
              .nonnegative()
              .describe("Mass in metric tonnes"),
          }),
        )
        .min(1)
        .describe("One or more fuel lines"),
    },
    async ({ fuels }) => {
      try {
        const result = emissionsFromFuelMasses(fuels);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("calculate_emissions_from_fuel failed", { error: error.message });
        throw error;
      }
    },
  );
}
