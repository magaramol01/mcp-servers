import type { Pool } from "pg";
import { computeCiiForPeriod, buildCiiDedupedReportsTraceQuery, resolveTenantFuelConfig } from "../cii/engine.js";
import { emissionsFromMassByFuelType, METHODOLOGY_ID } from "../accounting/ipccFactors.js";
import {
  fuelTotalsForReport,
  mergeFuelMaps,
  reportDistanceNm,
  reportMeRunningHrs,
} from "../accounting/fuelFromReports.js";
import { segmentVoyages } from "../accounting/voyageSegments.js";
import { LIST_REPORTS_FOR_VALIDATION } from "./reportQueries.js";

export const MRV_BUNDLE_METHODOLOGY_ID = "mcp-emission-engineer-mrv-audit-bundle-v1";

type BundleParams = {
  vesselId?: number;
  imo?: string;
  tenantName: string;
  startDate: string;
  endDate: string;
};

export async function buildMrvAuditBundle(pool: Pool, params: BundleParams): Promise<Record<string, unknown>> {
  const cii = await computeCiiForPeriod(pool, {
    vesselId: params.vesselId,
    imo: params.imo,
    tenantName: params.tenantName,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  const vesselId = (cii.vessel as { id?: number }).id;

  if (vesselId === undefined) {
    throw new Error("Missing vessel id in CII result");
  }

  const fuelConfig = resolveTenantFuelConfig(params.tenantName);

  const traceQuery = buildCiiDedupedReportsTraceQuery();
  const { rows: dedupedRows } = await pool.query<{
    id: number;
    report_date_time_utc: string;
    reporttype: string;
    canonical_reporttype: string;
    noonreportdata: unknown;
  }>(traceQuery, [vesselId, params.startDate, params.endDate]);

  const { rows: rawRows } = await pool.query<{
    id: number;
    report_date_time_utc: string;
    canonical_reporttype: string;
  }>(LIST_REPORTS_FOR_VALIDATION, [vesselId, params.startDate, params.endDate]);

  const duplicateKeys = new Map<string, number>();

  for (const row of rawRows) {
    const key = `${row.report_date_time_utc}\u0000${row.canonical_reporttype}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  const duplicate_timestamp_type_pairs = Array.from(duplicateKeys.entries()).filter(([, n]) => n > 1).length;

  const periodFuel: Record<string, number> = {};
  let periodDistance = 0;
  let periodMeHrs = 0;

  for (const r of dedupedRows) {
    mergeFuelMaps(periodFuel, fuelTotalsForReport(r.noonreportdata, fuelConfig.entries));
    periodDistance += reportDistanceNm(r.noonreportdata) ?? 0;
    periodMeHrs += reportMeRunningHrs(r.noonreportdata) ?? 0;
  }

  let periodEmissions: unknown;

  try {
    periodEmissions = emissionsFromMassByFuelType(periodFuel);
  } catch (error) {
    periodEmissions = { error: String(error) };
  }

  const voyageSplit = segmentVoyages(dedupedRows, "bosp_eosp");

  return {
    methodology_id: MRV_BUNDLE_METHODOLOGY_ID,
    accounting_methodology_id: METHODOLOGY_ID,
    tenant: params.tenantName,
    period: { startDate: params.startDate, endDate: params.endDate },
    cii,
    fuel_config: { source: fuelConfig.source, fuel_types: fuelConfig.entries.map((e) => e.type) },
    noon_report_quality: {
      raw_row_count: rawRows.length,
      deduplicated_row_count: dedupedRows.length,
      duplicate_timestamp_type_pairs,
      deduplication_rule:
        "CII-aligned: one row per (report_date_time_utc, canonical_reporttype); ASL preferred on ties.",
    },
    emissions_period_totals: {
      fuel_mt_by_type: periodFuel,
      distance_nm_sum: periodDistance,
      me_running_hours_sum: periodMeHrs,
      emissions: periodEmissions,
    },
    voyage_segmentation_summary: {
      mode: "bosp_eosp",
      voyage_count: voyageSplit.voyages.length,
      prelude_report_count: voyageSplit.prelude_reports.length,
      no_bosp_in_period: voyageSplit.no_bosp_in_period,
    },
    notes: [
      "Bundle for internal / verifier support — not a THETIS or GISIS submission.",
      "EU-related CO₂ share for ETS must come from MRV voyage allocation; use estimate_eu_ets_obligation with verified EU-scope tonnes.",
    ],
  };
}
