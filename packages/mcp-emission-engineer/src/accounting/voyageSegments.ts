export type DedupedReportRow = {
  id: number;
  report_date_time_utc: string;
  reporttype: string;
  canonical_reporttype: string;
  noonreportdata: unknown;
};

export type VoyageSegment = {
  /** 1-based index among BOSP/EOSP-derived segments only. */
  voyage_index: number;
  reports: DedupedReportRow[];
  incomplete: boolean;
};

export type SegmentResult = {
  mode: "bosp_eosp" | "period_single";
  voyages: VoyageSegment[];
  /** Reports before the first BOSP in range (bosp_eosp only). */
  prelude_reports: DedupedReportRow[];
  no_bosp_in_period: boolean;
};

/**
 * `bosp_eosp`: sea passages as rows from each BOSP through the next EOSP (inclusive).
 * Unclosed passages are flagged `incomplete`. Rows before the first BOSP are returned as `prelude_reports`.
 * `period_single`: one segment for the whole period (deduplicated rows).
 */
export function segmentVoyages(
  rows: DedupedReportRow[],
  mode: "bosp_eosp" | "period_single",
): SegmentResult {
  if (mode === "period_single") {
    return {
      mode,
      voyages: [
        {
          voyage_index: 1,
          reports: rows,
          incomplete: false,
        },
      ],
      prelude_reports: [],
      no_bosp_in_period: false,
    };
  }

  const firstBospIdx = rows.findIndex((r) => r.canonical_reporttype === "BOSPREPORT");
  const prelude_reports = firstBospIdx > 0 ? rows.slice(0, firstBospIdx) : [];
  const no_bosp_in_period = firstBospIdx < 0;

  if (no_bosp_in_period) {
    return {
      mode,
      voyages: [],
      prelude_reports: rows,
      no_bosp_in_period: true,
    };
  }

  const slice = rows.slice(firstBospIdx);
  const voyages: VoyageSegment[] = [];
  let current: DedupedReportRow[] | null = null;
  let voyageIndex = 0;

  const flushIncomplete = () => {
    if (current && current.length > 0) {
      voyageIndex += 1;
      voyages.push({
        voyage_index: voyageIndex,
        reports: current,
        incomplete: true,
      });
      current = null;
    }
  };

  for (const row of slice) {
    const c = row.canonical_reporttype;

    if (c === "BOSPREPORT") {
      flushIncomplete();
      current = [row];
      continue;
    }

    if (current) {
      current.push(row);

      if (c === "EOSPREPORT") {
        voyageIndex += 1;
        voyages.push({
          voyage_index: voyageIndex,
          reports: current,
          incomplete: false,
        });
        current = null;
      }
    }
  }

  flushIncomplete();

  return {
    mode,
    voyages,
    prelude_reports,
    no_bosp_in_period: false,
  };
}
