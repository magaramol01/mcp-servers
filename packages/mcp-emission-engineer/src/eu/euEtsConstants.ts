import { ValidationError } from "@mcpkit/utils";

/**
 * EU ETS extension to maritime (Directive (EU) 2023/959, MRV revision).
 * Surrender obligation is phased: % of verified emissions (CO₂) for EU-related voyages / port calls.
 * Source: European Commission / EMSA guidance (40% / 70% / 100% schedule for 2024–2026).
 */

export const METHODOLOGY_ID_EU_ETS = "mcp-emission-engineer-phase3-eu-ets-v1";

/** Percentage of verified emissions to be covered by EUA surrender (calendar years). */
export const EU_ETS_MARITIME_COVERAGE_PERCENT: Record<number, number> = {
  2024: 40,
  2025: 70,
  2026: 100,
  2027: 100,
  2028: 100,
  2029: 100,
  2030: 100,
};

export function getEuEtsMaritimeCoveragePercent(year: number): number {
  const direct = EU_ETS_MARITIME_COVERAGE_PERCENT[year];

  if (direct !== undefined) {
    return direct;
  }

  if (year < 2024) {
    throw new ValidationError(`EU ETS maritime not applicable for calendar year ${year} (before 2024)`);
  }

  if (year > 2030) {
    return 100;
  }

  throw new ValidationError(`EU ETS maritime coverage not defined for year ${year}`);
}
