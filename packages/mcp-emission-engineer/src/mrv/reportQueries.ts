import { CANONICAL_REPORTTYPE_SQL } from "../cii/engine.js";

/** All noon rows in range (no deduplication) — used for validation / audit bundles. */
export const LIST_REPORTS_FOR_VALIDATION = `
  SELECT
    r.id,
    r.report_date_time_utc::text AS report_date_time_utc,
    r.reporttype,
    ${CANONICAL_REPORTTYPE_SQL} AS canonical_reporttype,
    COALESCE(
      NULLIF(r.noonreportdata->>'Observed_Distance_GPS', '')::double precision,
      NULLIF(r.noonreportdata->>'Distance', '')::double precision,
      0
    )::double precision AS distance_nm
  FROM shipping_db.std_enoonreporttable AS r
  WHERE r.vesselid = $1
    AND r.report_date_time_utc >= $2::date
    AND r.report_date_time_utc < ($3::date + INTERVAL '1 day')
    AND r.reporttype NOT IN ('ABS Bunker Report', 'ABS Template')
  ORDER BY r.report_date_time_utc ASC, r.id ASC
`;
