import { toFiniteNumber } from "../cii/engine.js";
import type { CiiFuelConfigEntry } from "../cii/engine.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonNumber(data: Record<string, unknown>, tag: string): number | null {
  const raw = data[tag];

  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  return toFiniteNumber(raw);
}

/** Matches SQL `buildPreferredGroupExpression`: first tag group with any non-null value wins. */
export function preferredGroupSum(data: Record<string, unknown>, tagGroups: string[][]): number {
  for (const group of tagGroups) {
    const values = group.map((tag) => readJsonNumber(data, tag));
    const hasAny = values.some((value) => value !== null);

    if (hasAny) {
      return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }
  }

  return 0;
}

export function fuelTotalsForReport(
  noonreportdata: unknown,
  fuelEntries: CiiFuelConfigEntry[],
): Record<string, number> {
  if (!isRecord(noonreportdata)) {
    return {};
  }

  const totals: Record<string, number> = {};

  for (const entry of fuelEntries) {
    totals[entry.type] = preferredGroupSum(noonreportdata, entry.tagGroups);
  }

  return totals;
}

export function reportDistanceNm(noonreportdata: unknown): number | null {
  if (!isRecord(noonreportdata)) {
    return null;
  }

  return (
    toFiniteNumber(readJsonNumber(noonreportdata, "Observed_Distance_GPS")) ??
    toFiniteNumber(readJsonNumber(noonreportdata, "Distance"))
  );
}

export function reportMeRunningHrs(noonreportdata: unknown): number | null {
  if (!isRecord(noonreportdata)) {
    return null;
  }

  return toFiniteNumber(readJsonNumber(noonreportdata, "ME_Running_Hrs"));
}

/**
 * Sum per-type fuel maps (e.g. across reports in a voyage).
 */
export function mergeFuelMaps(
  target: Record<string, number>,
  add: Record<string, number>,
): void {
  for (const [type, mt] of Object.entries(add)) {
    target[type] = (target[type] ?? 0) + mt;
  }
}
