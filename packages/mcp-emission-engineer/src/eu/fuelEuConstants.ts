import { ValidationError } from "@mcpkit/utils";

/**
 * FuelEU Maritime — Regulation (EU) 2023/1805 (GHG intensity vs 2020 fossil reference).
 * Baseline and annual reduction targets: indicative values for planning; verify against
 * Commission delegated acts and MRV-reported energy for compliance submissions.
 */

export const METHODOLOGY_ID_EU_FUEL_EU = "mcp-emission-engineer-phase3-fueleu-v1";

/** Reference GHG intensity of fossil fuels (2020) — g CO₂e / MJ (well-to-wake convention per regulation). */
export const FUEL_EU_REFERENCE_INTENSITY_GCO2E_PER_MJ_2020 = 91.16;

/**
 * Minimum reduction of yearly average GHG intensity vs 2020 reference (percent points schedule).
 * Anchors from EC Q&A / guidance (2025 entry into force with 2% reduction target, 2030 6%, etc.).
 */
export const FUEL_EU_MIN_REDUCTION_PERCENT_VS_2020: Array<{ fromYear: number; reductionPercent: number }> = [
  { fromYear: 2025, reductionPercent: 2 },
  { fromYear: 2030, reductionPercent: 6 },
  { fromYear: 2035, reductionPercent: 14.5 },
  { fromYear: 2040, reductionPercent: 31 },
  { fromYear: 2045, reductionPercent: 62 },
  { fromYear: 2050, reductionPercent: 80 },
];

export function requiredFuelEuIntensityGco2ePerMj(reportingYear: number): number {
  if (reportingYear < 2025) {
    throw new ValidationError(
      `FuelEU Maritime intensity requirements apply from 2025 (got ${reportingYear})`,
    );
  }

  const baseline = FUEL_EU_REFERENCE_INTENSITY_GCO2E_PER_MJ_2020;
  const anchors = [...FUEL_EU_MIN_REDUCTION_PERCENT_VS_2020].sort((a, b) => a.fromYear - b.fromYear);

  let reduction = 80;

  for (let i = 0; i < anchors.length; i++) {
    const current = anchors[i];
    const next = anchors[i + 1];

    if (!current) {
      continue;
    }

    if (reportingYear < (next?.fromYear ?? Number.POSITIVE_INFINITY)) {
      if (!next || reportingYear === current.fromYear) {
        reduction = current.reductionPercent;
        break;
      }

      const t =
        (reportingYear - current.fromYear) / (next.fromYear - current.fromYear);
      reduction =
        current.reductionPercent +
        t * (next.reductionPercent - current.reductionPercent);
      break;
    }
  }

  return baseline * (1 - reduction / 100);
}
