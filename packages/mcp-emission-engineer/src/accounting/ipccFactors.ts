import { ValidationError } from "@mcpkit/utils";

/**
 * IPCC / IMO-aligned factors for Phase 2 accounting tools.
 * CO₂ (t CO₂ / t fuel): IMO Resolution MEPC.308(73) default values (same family as CII).
 * CH₄ / N₂O: IPCC 2006 Guidelines Vol. 2, Table 2.2 (Tier 1, stationary combustion) converted
 *   using typical net calorific values (TJ/t fuel) from the same source / IMO fuel tables.
 *
 * GWP₁₀₀: IPCC AR5 (WG I) for CH₄ and N₂O (tool output documents this).
 */

export const METHODOLOGY_ID = "mcp-emission-engineer-phase2-v1";

/** IPCC AR5 GWP₁₀₀ (100-year). */
export const GWP100 = {
  ch4: 28,
  n2o: 265,
} as const;

/** Typical NCV (TJ/t) used to convert kg/TJ factors to per-tonne-fuel. */
const NCV_TJ_PER_T: Record<string, number> = {
  hfo: 40.4,
  vlsfo: 41.2,
  lsfo: 41.2,
  ulsgo: 42.7,
  vlsgo: 42.7,
  mgo: 42.7,
  lsmgo: 42.7,
  lfo: 40.8,
  lng: 49.5,
  methanol: 19.9,
  lpg_propane: 46.4,
};

/** kg CH₄ / TJ (IPCC 2006 Table 2.2 — liquid fuels, stationary). */
const CH4_KG_PER_TJ_DEFAULT = 1;
/** kg N₂O / TJ (IPCC 2006 Table 2.2 — liquid fuels, stationary). */
const N2O_KG_PER_TJ_DEFAULT = 0.6;

/** LNG Otto-cycle / high-slip placeholder — replace with measured data when available. */
const LNG_CH4_SLIP_KG_PER_TJ = 30;

export type KnownFuelType =
  | "hfo"
  | "vlsfo"
  | "lsfo"
  | "ulsgo"
  | "vlsgo"
  | "mgo"
  | "lsmgo"
  | "lfo"
  | "lng"
  | "methanol"
  | "lpg_propane";

/** IMO-style CO₂ conversion (t CO₂ / t fuel). */
export const IMO_CO2_T_PER_T_FUEL: Record<KnownFuelType, number> = {
  hfo: 3.114,
  vlsfo: 3.15,
  lsfo: 3.15,
  ulsgo: 3.206,
  vlsgo: 3.206,
  mgo: 3.206,
  lsmgo: 3.206,
  lfo: 3.151,
  lng: 2.75,
  methanol: 1.375,
  lpg_propane: 3.0,
};

/** Canonical fuel keys accepted after alias resolution (sorted for stable docs). */
export const KNOWN_FUEL_CANONICAL_KEYS: readonly KnownFuelType[] = (
  Object.keys(IMO_CO2_T_PER_T_FUEL) as KnownFuelType[]
).sort((a, b) => a.localeCompare(b));

/**
 * Normalized lookup keys (lowercase, spaces → _) → canonical {@link KnownFuelType}.
 * Used by {@link resolveFuelType} and agent-facing docs.
 */
export const FUEL_TYPE_ALIASES: Record<string, KnownFuelType> = {
  hfo: "hfo",
  hsfo: "hfo",
  vlsfo: "vlsfo",
  lsfo: "lsfo",
  ulsgo: "ulsgo",
  uls: "ulsgo",
  vlsgo: "vlsgo",
  mgo: "mgo",
  mdo: "mgo",
  lsmgo: "lsmgo",
  lfo: "lfo",
  lng: "lng",
  methanol: "methanol",
  lpg: "lpg_propane",
  propane: "lpg_propane",
};

function normalizeFuelKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

export function resolveFuelType(raw: string): KnownFuelType {
  const key = normalizeFuelKey(raw);
  const resolved = FUEL_TYPE_ALIASES[key];

  if (!resolved) {
    throw new ValidationError(`Unknown fuel type for emission factors: ${raw}`);
  }

  return resolved;
}

function ch4N2oTonnesPerTonFuel(fuel: KnownFuelType): { ch4_t_per_t: number; n2o_t_per_t: number } {
  const ncv = NCV_TJ_PER_T[fuel] ?? 42;
  const ch4KgPerT = CH4_KG_PER_TJ_DEFAULT * ncv;
  let n2oKgPerT = N2O_KG_PER_TJ_DEFAULT * ncv;

  if (fuel === "lng") {
    const ch4KgPerTlng = LNG_CH4_SLIP_KG_PER_TJ * ncv;
    return {
      ch4_t_per_t: ch4KgPerTlng / 1000,
      n2o_t_per_t: n2oKgPerT / 1000,
    };
  }

  if (fuel === "methanol") {
    n2oKgPerT = 0.3 * ncv;
  }

  return {
    ch4_t_per_t: ch4KgPerT / 1000,
    n2o_t_per_t: n2oKgPerT / 1000,
  };
}

export type FuelLineEmissions = {
  fuel_type: KnownFuelType;
  mass_mt: number;
  co2_tonnes: number;
  ch4_tonnes: number;
  n2o_tonnes: number;
  ch4_co2e_tonnes: number;
  n2o_co2e_tonnes: number;
  co2e_tonnes: number;
};

export type AggregatedEmissions = {
  methodology_id: string;
  assumptions: string[];
  gwp100: typeof GWP100;
  lines: FuelLineEmissions[];
  totals: {
    co2_tonnes: number;
    ch4_tonnes: number;
    n2o_tonnes: number;
    ch4_co2e_tonnes: number;
    n2o_co2e_tonnes: number;
    co2e_tonnes: number;
  };
};

export function emissionsFromFuelMasses(
  masses: Array<{ fuel_type: string; mass_mt: number }>,
): AggregatedEmissions {
  const assumptions = [
    "CO₂: IMO default conversion factors (t CO₂/t fuel), same family as CII.",
    `CH₄/N₂O: IPCC 2006 Tier 1 (Table 2.2) with NCV from IPCC/typical marine values; LNG CH₄ uses illustrative slip factor (${LNG_CH4_SLIP_KG_PER_TJ} kg/TJ) — replace with vessel-specific data when available.`,
    `GWP₁₀₀: IPCC AR5 — CH₄ ${GWP100.ch4}, N₂O ${GWP100.n2o}.`,
  ];

  const lines: FuelLineEmissions[] = [];

  for (const row of masses) {
    if (row.mass_mt < 0 || !Number.isFinite(row.mass_mt)) {
      throw new ValidationError("mass_mt must be a non-negative finite number");
    }

    if (row.mass_mt === 0) {
      continue;
    }

    const fuel = resolveFuelType(row.fuel_type);
    const co2PerT = IMO_CO2_T_PER_T_FUEL[fuel];
    const { ch4_t_per_t, n2o_t_per_t } = ch4N2oTonnesPerTonFuel(fuel);
    const co2_tonnes = row.mass_mt * co2PerT;
    const ch4_tonnes = row.mass_mt * ch4_t_per_t;
    const n2o_tonnes = row.mass_mt * n2o_t_per_t;
    const ch4_co2e_tonnes = ch4_tonnes * GWP100.ch4;
    const n2o_co2e_tonnes = n2o_tonnes * GWP100.n2o;
    const co2e_tonnes = co2_tonnes + ch4_co2e_tonnes + n2o_co2e_tonnes;

    lines.push({
      fuel_type: fuel,
      mass_mt: row.mass_mt,
      co2_tonnes,
      ch4_tonnes,
      n2o_tonnes,
      ch4_co2e_tonnes,
      n2o_co2e_tonnes,
      co2e_tonnes,
    });
  }

  const totals = lines.reduce(
    (acc, line) => ({
      co2_tonnes: acc.co2_tonnes + line.co2_tonnes,
      ch4_tonnes: acc.ch4_tonnes + line.ch4_tonnes,
      n2o_tonnes: acc.n2o_tonnes + line.n2o_tonnes,
      ch4_co2e_tonnes: acc.ch4_co2e_tonnes + line.ch4_co2e_tonnes,
      n2o_co2e_tonnes: acc.n2o_co2e_tonnes + line.n2o_co2e_tonnes,
      co2e_tonnes: acc.co2e_tonnes + line.co2e_tonnes,
    }),
    {
      co2_tonnes: 0,
      ch4_tonnes: 0,
      n2o_tonnes: 0,
      ch4_co2e_tonnes: 0,
      n2o_co2e_tonnes: 0,
      co2e_tonnes: 0,
    },
  );

  return {
    methodology_id: METHODOLOGY_ID,
    assumptions,
    gwp100: GWP100,
    lines,
    totals,
  };
}

export function emissionsFromMassByFuelType(masses: Record<string, number>): AggregatedEmissions {
  const list = Object.entries(masses)
    .filter(([, mt]) => mt > 0)
    .map(([fuel_type, mass_mt]) => ({ fuel_type, mass_mt }));

  return emissionsFromFuelMasses(list);
}
