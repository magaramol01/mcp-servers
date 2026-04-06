import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Pool } from "pg";
import {
  NotFoundError,
  toError,
  ValidationError,
} from "@mcpkit/utils";
import {
  getReportingYear,
  normalizeIsoDateInput,
  normalizeVesselId,
  resolveTenantName,
} from "../tools/shared.js";

export const CII_REDUCTION_FACTORS: Record<number, number> = {
  2020: 3,
  2021: 3,
  2022: 3,
  2023: 5,
  2024: 7,
  2025: 9,
  2026: 11,
  2027: 13,
  2028: 15,
  2029: 17,
  2030: 20,
};

export type CiiRating = "A" | "B" | "C" | "D" | "E";

export type SupportedShipCategory = "Bulker" | "Container" | "Tanker" | "GeneralCargo";

type RatingThresholds = {
  d1: number;
  d2: number;
  d3: number;
  d4: number;
};

export type CiiFuelConfigEntry = {
  type: string;
  coefficient: number;
  tagGroups: string[][];
};

type ResolvedFuelConfig = {
  source: string;
  entries: CiiFuelConfigEntry[];
};

type CategoryStaticConfig = {
  ratingThresholds: RatingThresholds;
  capacityField: "deadweight";
  /** When set, used as CII_ref = a * dw^-c. Otherwise `resolveReferenceLine` must handle the category. */
  referenceLine?: { a: number; c: number };
};

/**
 * Reference lines: MEPC.353(78) — CII Reference Lines (G2). Rating band ratios (d1–d4): MEPC G4;
 * Bulker/Container thresholds match existing implementation; Tanker/GeneralCargo use Bulker bands until verified per ship type.
 */
export const CATEGORY_CONFIG: Record<SupportedShipCategory, CategoryStaticConfig> = {
  Bulker: {
    referenceLine: { a: 4745, c: 0.622 },
    ratingThresholds: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
    capacityField: "deadweight",
  },
  Container: {
    referenceLine: { a: 1984, c: 0.489 },
    ratingThresholds: { d1: 0.83, d2: 0.94, d3: 1.07, d4: 1.19 },
    capacityField: "deadweight",
  },
  Tanker: {
    referenceLine: { a: 5247, c: 0.61 },
    ratingThresholds: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
    capacityField: "deadweight",
  },
  GeneralCargo: {
    ratingThresholds: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
    capacityField: "deadweight",
  },
};

/** MEPC.353(78): general cargo uses two segments by DWT. */
export function getGeneralCargoReferenceLine(deadweight: number): { a: number; c: number } {
  if (deadweight >= 20_000) {
    return { a: 31_948, c: 0.792 };
  }

  return { a: 588, c: 0.3885 };
}

export function getReferenceLineForCategory(
  category: SupportedShipCategory,
  deadweight: number,
): { a: number; c: number } {
  if (category === "GeneralCargo") {
    return getGeneralCargoReferenceLine(deadweight);
  }

  const line = CATEGORY_CONFIG[category].referenceLine;

  if (!line) {
    throw new ValidationError(`Missing reference line for category ${category}`);
  }

  return line;
}

export const DEFAULT_CII_FUEL_CONFIG_SOURCE = {
  ciiData: {
    fuelData: [
      {
        type: "hfo",
        coefficient: 3.114,
        tags: [
          [
            "Total_HFOME_Consumed_In_MT",
            "Total_HFOAE_Consumed_In_MT",
            "Total_HFOBLR_Consumed_In_MT",
          ],
          ["Total_HFO_Consumed_In_MT"],
        ],
      },
      {
        type: "vlsfo",
        coefficient: 3.15,
        tags: [
          [
            "Total_VLSFOME_Consumed_In_MT",
            "Total_VLSFOAX_Consumed_In_MT",
            "Total_VLSFOBLR_Consumed_In_MT",
          ],
          ["Total_VLSFO_Consumed_In_MT"],
        ],
      },
      {
        type: "lsfo",
        coefficient: 3.15,
        tags: [
          [
            "Total_LSFOME_Consumed_In_MT",
            "Total_LSFOAE_Consumed_In_MT",
            "Total_LSFOBLR_Consumed_In_MT",
          ],
          ["Total_LSFO_Consumed _In _Mt"],
        ],
      },
      {
        type: "ulsgo",
        coefficient: 3.206,
        tags: [
          [
            "Total_ULSGOME_Consumed_In_MT",
            "Total_ULSGOAE_Consumed_In_MT",
            "Total_ULSGOBLR_Consumed_In_MT",
          ],
          ["Total_ULSGO_Consumed_In_MT"],
        ],
      },
      {
        type: "vlsgo",
        coefficient: 3.206,
        tags: [
          [
            "Total_VLSGOME_Consumed_In_MT",
            "Total_VLSGOAX_Consumed_In_MT",
            "Total_VLSGOBLR_Consumed_In_MT",
          ],
          ["Total_VLSGO_Consumed_In_MT"],
        ],
      },
      {
        type: "mgo",
        coefficient: 3.206,
        tags: [
          [
            "MGOME_CONSUMED_IN_MT",
            "AE_MGO_CONSUMPTION",
            "BOILER_MGO_CONSUMPTION",
          ],
          ["Total_ULSMDO_Consumed_In_MT"],
        ],
      },
      {
        type: "lsmgo",
        coefficient: 3.206,
        tags: [
          [
            "ME_MGOLS_CONSUMPTION",
            "AE_MGOLS_CONSUMPTION",
            "AE_MDOLS_CONSUMPTION",
            "BOILER_LSMGO_CONSUMPTION",
            "BOILER_MDOLS_CONSUMPTION",
          ],
          [
            "Total_MGOLSME_Consumed_In_MT",
            "Total_MGOLSAE_Consumed_In_MT",
            "Total_MGOLSBLR_Consumed_In_MT",
          ],
        ],
      },
      {
        type: "lfo",
        coefficient: 3.151,
        tags: [
          [
            "Total_LFOME_Consumed_In_MT",
            "Total_LFOAE_Consumed_In_MT",
            "Total_LFOBLR_Consumed_In_MT",
          ],
          ["Total_LFO_Consumed_In_MT"],
        ],
      },
    ],
  },
} as const;

const COMMON_CONFIG_KEYS = new Set([
  "config",
  "configs",
  "default",
  "defaults",
  "shared",
  "common",
  "tenants",
  "tenantconfigs",
]);

export const GET_VESSEL_CII_CONTEXT_QUERY = `
  SELECT
    s.id,
    s.name,
    s.imo,
    s.category,
    s.deadweight::double precision AS deadweight
  FROM shipping_db.ship AS s
  WHERE ($1::integer IS NULL OR s.id = $1)
    AND ($2::text IS NULL OR s.imo = $2)
  ORDER BY s.id ASC
  LIMIT 1
`;

export const CANONICAL_REPORTTYPE_SQL = `
  CASE
    WHEN r.reporttype = 'ASL - Noon Report' THEN 'NOONREPORT'
    WHEN r.reporttype = 'ASL - BOSP Report' THEN 'BOSPREPORT'
    WHEN r.reporttype = 'ASL - EOSP Report' THEN 'EOSPREPORT'
    WHEN r.reporttype = 'ASL - Port Report' THEN 'PortReport'
    WHEN r.reporttype = 'ASL - Arrival Report' THEN 'ARRIVALREPORT'
    WHEN r.reporttype = 'ASL - Departure Report' THEN 'DEPARTUREREPORT'
    WHEN r.reporttype = 'ASL - Anchorage / Layup Report' THEN 'LAYUPREPORT'
    ELSE r.reporttype
  END
`;

export type VesselContextRow = {
  id: number;
  name: string | null;
  imo: string | null;
  category: string | null;
  deadweight: number | null;
};

export type BaseCiiAggregateRow = {
  report_count: number | string | null;
  first_report_at: string | null;
  last_report_at: string | null;
  me_running_hours: number | string | null;
  distance_nm: number | string | null;
  report_types: Record<string, number> | string | null;
};

let cachedFuelConfigSource:
  | {
      cacheKey: string;
      source: string;
      value: unknown;
    }
  | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function toNumberOrZero(value: unknown): number {
  return toFiniteNumber(value) ?? 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isOverallTotalTag(tag: string): boolean {
  const normalizedTag = tag.trim().toUpperCase();

  return (
    normalizedTag.startsWith("TOTAL_") &&
    !normalizedTag.includes("ME") &&
    !normalizedTag.includes("AE") &&
    !normalizedTag.includes("AX") &&
    !normalizedTag.includes("BLR")
  );
}

function normalizeTagGroups(rawTags: unknown): string[][] {
  const rawGroups =
    Array.isArray(rawTags) && rawTags.every((item) => typeof item === "string")
      ? [rawTags]
      : Array.isArray(rawTags)
        ? rawTags
        : [];

  const expandedGroups: string[][] = [];

  for (const rawGroup of rawGroups) {
    const tags = Array.isArray(rawGroup)
      ? rawGroup
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : typeof rawGroup === "string"
        ? [rawGroup.trim()].filter(Boolean)
        : [];

    if (tags.length === 0) {
      continue;
    }

    const overallTotalTags = uniqueStrings(tags.filter((tag) => isOverallTotalTag(tag)));
    const componentTags = uniqueStrings(tags.filter((tag) => !isOverallTotalTag(tag)));

    if (componentTags.length > 0) {
      expandedGroups.push(componentTags);
    }

    if (overallTotalTags.length > 0) {
      expandedGroups.push(overallTotalTags);
    }
  }

  return Array.from(
    new Map(
      expandedGroups
        .sort((left, right) => right.length - left.length)
        .map((group) => [group.join("\u001f"), group]),
    ).values(),
  );
}

function hasFuelData(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = isRecord(value.ciiData) ? value.ciiData : value;

  return (
    Array.isArray(candidate.fuelData) ||
    Array.isArray(candidate.fuelDataME) ||
    Array.isArray(candidate.fuelDataAUX) ||
    Array.isArray(candidate.fuelDataBLR)
  );
}

function findFuelConfigNode(node: unknown, depth = 0): unknown | null {
  if (depth > 8 || !isRecord(node)) {
    return null;
  }

  if (hasFuelData(node)) {
    return node;
  }

  for (const value of Object.values(node)) {
    const match = findFuelConfigNode(value, depth + 1);

    if (match) {
      return match;
    }
  }

  return null;
}

function findNodeByKey(node: unknown, targetKey: string, depth = 0): unknown | null {
  if (depth > 8 || !isRecord(node)) {
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.trim().toLowerCase() === targetKey.trim().toLowerCase()) {
      return value;
    }
  }

  for (const value of Object.values(node)) {
    const match = findNodeByKey(value, targetKey, depth + 1);

    if (match) {
      return match;
    }
  }

  return null;
}

function getConfiguredFuelConfigSource(): { source: string; value: unknown } {
  const configPath = process.env.EMISSION_ENGINEER_CII_FUEL_CONFIG_PATH?.trim() ?? "";
  const configJson = process.env.EMISSION_ENGINEER_CII_FUEL_CONFIG_JSON?.trim() ?? "";
  const cacheKey = `${configPath}::${configJson}`;

  if (cachedFuelConfigSource?.cacheKey === cacheKey) {
    return cachedFuelConfigSource;
  }

  let source = "built-in-default";
  let value: unknown = DEFAULT_CII_FUEL_CONFIG_SOURCE;

  if (configPath) {
    const absolutePath = resolvePath(configPath);

    if (!existsSync(absolutePath)) {
      throw new ValidationError(
        `CII fuel config file not found: ${absolutePath}`,
      );
    }

    try {
      value = JSON.parse(readFileSync(absolutePath, "utf8"));
      source = `file:${absolutePath}`;
    } catch (error) {
      throw new ValidationError(
        `Unable to parse CII fuel config file: ${toError(error).message}`,
      );
    }
  } else if (configJson) {
    try {
      value = JSON.parse(configJson);
      source = "env:EMISSION_ENGINEER_CII_FUEL_CONFIG_JSON";
    } catch (error) {
      throw new ValidationError(
        `Unable to parse EMISSION_ENGINEER_CII_FUEL_CONFIG_JSON: ${toError(error).message}`,
      );
    }
  } else {
    const defaultConfigCandidates = [
      resolvePath(__dirname, "../conf/conf.json"),
      resolvePath(__dirname, "../../src/conf/conf.json"),
      resolvePath(process.cwd(), "packages/mcp-emission-engineer/src/conf/conf.json"),
    ];

    const defaultConfigPath = defaultConfigCandidates.find((candidatePath) =>
      existsSync(candidatePath),
    );

    if (defaultConfigPath) {
      try {
        value = JSON.parse(readFileSync(defaultConfigPath, "utf8"));
        source = `file:${defaultConfigPath}`;
      } catch (error) {
        throw new ValidationError(
          `Unable to parse default CII config file: ${toError(error).message}`,
        );
      }
    }
  }

  cachedFuelConfigSource = { cacheKey, source, value };
  return cachedFuelConfigSource;
}

function parseFuelEntriesFromFuelData(value: unknown): CiiFuelConfigEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entriesByType = new Map<string, CiiFuelConfigEntry>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
    const coefficient = toFiniteNumber(item.coefficient);
    const tagGroups = normalizeTagGroups(item.tags);

    if (!type || coefficient === null || tagGroups.length === 0) {
      continue;
    }

    const existingEntry = entriesByType.get(type);

    if (existingEntry) {
      existingEntry.tagGroups = Array.from(
        new Map(
          [...existingEntry.tagGroups, ...tagGroups].map((group) => [
            group.join("\u001f"),
            group,
          ]),
        ).values(),
      ).sort((left, right) => right.length - left.length);
      continue;
    }

    entriesByType.set(type, {
      type,
      coefficient,
      tagGroups,
    });
  }

  return Array.from(entriesByType.values());
}

function parseFuelEntriesFromSections(value: Record<string, unknown>): CiiFuelConfigEntry[] {
  const sectionNames = ["fuelDataME", "fuelDataAUX", "fuelDataBLR"];
  const entriesByType = new Map<string, { coefficient: number; tags: string[] }>();

  for (const sectionName of sectionNames) {
    const section = value[sectionName];

    if (!Array.isArray(section)) {
      continue;
    }

    for (const item of section) {
      if (!isRecord(item)) {
        continue;
      }

      const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
      const coefficient = toFiniteNumber(item.coefficient);
      const tagGroups = normalizeTagGroups(item.tags);

      if (!type || coefficient === null || tagGroups.length === 0) {
        continue;
      }

      const flattenedTags = tagGroups.flat();
      const existingEntry = entriesByType.get(type);

      if (existingEntry) {
        existingEntry.tags.push(...flattenedTags);
        continue;
      }

      entriesByType.set(type, {
        coefficient,
        tags: [...flattenedTags],
      });
    }
  }

  return Array.from(entriesByType.entries()).map(([type, entry]) => ({
    type,
    coefficient: entry.coefficient,
    tagGroups: normalizeTagGroups(uniqueStrings(entry.tags)),
  }));
}

function parseFuelEntries(configNode: unknown): CiiFuelConfigEntry[] {
  if (!isRecord(configNode)) {
    return [];
  }

  const ciiData = isRecord(configNode.ciiData) ? configNode.ciiData : configNode;

  const directFuelEntries = parseFuelEntriesFromFuelData(ciiData.fuelData);

  if (directFuelEntries.length > 0) {
    return directFuelEntries;
  }

  return parseFuelEntriesFromSections(ciiData);
}

export function resolveTenantFuelConfig(tenantName: string): ResolvedFuelConfig {
  const configuredSource = getConfiguredFuelConfigSource();
  const tenantNode = findNodeByKey(configuredSource.value, tenantName);
  const commonNode = Array.from(COMMON_CONFIG_KEYS)
    .map((key) => findNodeByKey(configuredSource.value, key))
    .find((value) => value !== null);
  const configNode =
    (tenantNode ? findFuelConfigNode(tenantNode) : null) ??
    (commonNode ? findFuelConfigNode(commonNode) : null) ??
    findFuelConfigNode(configuredSource.value);

  if (!configNode) {
    throw new ValidationError(
      `Unable to resolve CII fuel config for tenant ${tenantName}`,
    );
  }

  const entries = parseFuelEntries(configNode);

  if (entries.length === 0) {
    throw new ValidationError(
      `CII fuel config for tenant ${tenantName} does not contain usable fuelData entries`,
    );
  }

  return {
    source: configuredSource.source,
    entries,
  };
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildJsonNumberExpression(rowAlias: string, tag: string): string {
  return `NULLIF(${rowAlias}.noonreportdata->>'${escapeSqlLiteral(tag)}', '')::double precision`;
}

function buildPreferredGroupExpression(groups: string[][], rowAlias: string): string {
  if (groups.length === 0) {
    return "0";
  }

  const whenClauses = groups.map((group) => {
    const valueExpressions = group.map((tag) => buildJsonNumberExpression(rowAlias, tag));
    const hasAnyValue = valueExpressions.map((expr) => `${expr} IS NOT NULL`).join(" OR ");
    const groupSum = valueExpressions
      .map((expr) => `COALESCE(${expr}, 0)`)
      .join(" + ");

    return `WHEN ${hasAnyValue} THEN ${groupSum}`;
  });

  return `CASE ${whenClauses.join(" ")} ELSE 0 END`;
}

export function buildCiiAggregateQuery(
  fuelEntries: CiiFuelConfigEntry[],
): {
  query: string;
  fuelColumns: Array<{ type: string; alias: string; coefficient: number }>;
} {
  const fuelColumns = fuelEntries.map((entry, index) => ({
    type: entry.type,
    alias: `fuel_${index}_mt`,
    coefficient: entry.coefficient,
  }));

  const fuelAggregateSql =
    fuelEntries.length > 0
      ? `,\n      ${fuelEntries
          .map(
            (entry, index) =>
              `SUM(${buildPreferredGroupExpression(entry.tagGroups, "d")})::double precision AS fuel_${index}_mt`,
          )
          .join(",\n      ")}`
      : "";

  return {
    fuelColumns,
    query: `
      WITH normalized_reports AS (
        SELECT
          r.id,
          r.report_date_time_utc,
          r.reporttype,
          r.noonreportdata,
          ${CANONICAL_REPORTTYPE_SQL} AS canonical_reporttype
        FROM shipping_db.std_enoonreporttable AS r
        WHERE r.vesselid = $1
          AND r.report_date_time_utc >= $2::date
          AND r.report_date_time_utc < ($3::date + INTERVAL '1 day')
          AND r.reporttype NOT IN ('ABS Bunker Report', 'ABS Template')
      ),
      deduplicated_reports AS (
        SELECT *
        FROM (
          SELECT
            normalized_reports.*,
            ROW_NUMBER() OVER (
              PARTITION BY normalized_reports.report_date_time_utc, normalized_reports.canonical_reporttype
              ORDER BY
                CASE WHEN normalized_reports.reporttype LIKE 'ASL - %' THEN 1 ELSE 0 END ASC,
                normalized_reports.id DESC
            ) AS preferred_rank
          FROM normalized_reports
        ) AS ranked_reports
        WHERE preferred_rank = 1
      ),
      aggregated_reports AS (
        SELECT
          COUNT(*)::integer AS report_count,
          MIN(d.report_date_time_utc)::text AS first_report_at,
          MAX(d.report_date_time_utc)::text AS last_report_at,
          SUM(
            COALESCE(
              NULLIF(d.noonreportdata->>'ME_Running_Hrs', '')::double precision,
              0
            )
          )::double precision AS me_running_hours,
          SUM(
            COALESCE(
              NULLIF(d.noonreportdata->>'Observed_Distance_GPS', '')::double precision,
              NULLIF(d.noonreportdata->>'Distance', '')::double precision,
              0
            )
          )::double precision AS distance_nm${fuelAggregateSql}
        FROM deduplicated_reports AS d
      ),
      report_type_breakdown AS (
        SELECT
          COALESCE(jsonb_object_agg(grouped.canonical_reporttype, grouped.report_count), '{}'::jsonb)
            AS report_types
        FROM (
          SELECT canonical_reporttype, COUNT(*)::integer AS report_count
          FROM deduplicated_reports
          GROUP BY canonical_reporttype
        ) AS grouped
      )
      SELECT
        aggregated_reports.*,
        report_type_breakdown.report_types
      FROM aggregated_reports
      CROSS JOIN report_type_breakdown
    `,
  };
}

export function buildCiiDedupedReportsTraceQuery(): string {
  return `
    WITH normalized_reports AS (
      SELECT
        r.id,
        r.report_date_time_utc,
        r.reporttype,
        r.noonreportdata,
        ${CANONICAL_REPORTTYPE_SQL} AS canonical_reporttype
      FROM shipping_db.std_enoonreporttable AS r
      WHERE r.vesselid = $1
        AND r.report_date_time_utc >= $2::date
        AND r.report_date_time_utc < ($3::date + INTERVAL '1 day')
        AND r.reporttype NOT IN ('ABS Bunker Report', 'ABS Template')
    ),
    deduplicated_reports AS (
      SELECT *
      FROM (
        SELECT
          normalized_reports.*,
          ROW_NUMBER() OVER (
            PARTITION BY normalized_reports.report_date_time_utc, normalized_reports.canonical_reporttype
            ORDER BY
              CASE WHEN normalized_reports.reporttype LIKE 'ASL - %' THEN 1 ELSE 0 END ASC,
              normalized_reports.id DESC
          ) AS preferred_rank
        FROM normalized_reports
      ) AS ranked_reports
      WHERE preferred_rank = 1
    )
    SELECT
      d.id,
      d.report_date_time_utc::text AS report_date_time_utc,
      d.reporttype,
      d.canonical_reporttype,
      d.noonreportdata
    FROM deduplicated_reports AS d
    ORDER BY d.report_date_time_utc ASC, d.id ASC
  `;
}

export function normalizeShipCategory(rawCategory: string | null | undefined): SupportedShipCategory {
  const normalizedCategory = rawCategory?.trim().toLowerCase();

  switch (normalizedCategory) {
    case "bulker":
    case "bulk carrier":
      return "Bulker";
    case "container":
    case "container ship":
      return "Container";
    case "tanker":
    case "oil tanker":
    case "chemical tanker":
    case "product tanker":
    case "crude tanker":
      return "Tanker";
    case "general cargo":
    case "general cargo ship":
    case "gen cargo":
      return "GeneralCargo";
    default:
      throw new ValidationError(
        `Unsupported ship category for CII calculation: ${rawCategory ?? "unknown"}`,
      );
  }
}

export function resolveDeadweight(vessel: VesselContextRow): number {
  const deadweight = toFiniteNumber(vessel.deadweight);

  if (deadweight === null || deadweight <= 0) {
    throw new ValidationError(
      `Missing or invalid deadweight for vessel ${vessel.name ?? vessel.id}`,
    );
  }

  return deadweight;
}

export function getReductionFactor(reportingYear: number): number {
  const reductionFactor = CII_REDUCTION_FACTORS[reportingYear];

  if (reductionFactor === undefined) {
    throw new ValidationError(`Unsupported CII reporting year: ${reportingYear}`);
  }

  return reductionFactor;
}

export function getCiiRating(
  attainedOverRequiredRatio: number,
  ratingThresholds: RatingThresholds,
): CiiRating {
  if (attainedOverRequiredRatio < ratingThresholds.d1) {
    return "A";
  }

  if (attainedOverRequiredRatio < ratingThresholds.d2) {
    return "B";
  }

  if (attainedOverRequiredRatio < ratingThresholds.d3) {
    return "C";
  }

  if (attainedOverRequiredRatio < ratingThresholds.d4) {
    return "D";
  }

  return "E";
}

function parseReportTypes(
  value: Record<string, number> | string | null,
): Record<string, number> {
  if (!value) {
    return {};
  }

  const parsedValue = typeof value === "string" ? JSON.parse(value) : value;

  return Object.fromEntries(
    Object.entries(parsedValue).map(([reportType, count]) => [
      reportType,
      toNumberOrZero(count),
    ]),
  );
}

export function buildFuelConsumption(
  aggregateRow: Record<string, unknown> | null | undefined,
  fuelColumns: Array<{ type: string; alias: string }>,
): Record<string, number> {
  return Object.fromEntries(
    fuelColumns.map(({ type, alias }) => [type, toNumberOrZero(aggregateRow?.[alias])]),
  );
}

export function calculateTotalCo2Tonnes(
  fuelConsumption: Record<string, number>,
  fuelEntries: CiiFuelConfigEntry[],
): number {
  return fuelEntries.reduce(
    (totalCo2Tonnes, entry) =>
      totalCo2Tonnes + (fuelConsumption[entry.type] ?? 0) * entry.coefficient,
    0,
  );
}

export type CiiComputationResult = Record<string, unknown>;

export async function computeCiiForPeriod(
  pool: Pool,
  params: {
    vesselId?: number;
    imo?: string;
    tenantName: string;
    startDate: string;
    endDate: string;
  },
): Promise<CiiComputationResult> {
  const { vesselId, imo, tenantName, startDate, endDate } = params;

  if (vesselId === undefined && imo === undefined) {
    throw new ValidationError("Provide either vesselId or imo");
  }

  const normalizedStartDate = normalizeIsoDateInput("startDate", startDate);
  const normalizedEndDate = normalizeIsoDateInput("endDate", endDate);

  if (normalizedStartDate > normalizedEndDate) {
    throw new ValidationError("startDate must be on or before endDate");
  }

  const reportingYear = getReportingYear(normalizedStartDate, normalizedEndDate);
  const resolvedFuelConfig = resolveTenantFuelConfig(tenantName);
  const { query: aggregateQuery, fuelColumns } = buildCiiAggregateQuery(
    resolvedFuelConfig.entries,
  );

  const [{ rows: vesselRows }, { rows: aggregateRows }] = await Promise.all([
    pool.query<VesselContextRow>(GET_VESSEL_CII_CONTEXT_QUERY, [
      vesselId ?? null,
      imo ?? null,
    ]),
    pool.query<Record<string, unknown> & BaseCiiAggregateRow>(aggregateQuery, [
      vesselId ?? null,
      normalizedStartDate,
      normalizedEndDate,
    ]),
  ]);

  const vessel = vesselRows[0];

  if (!vessel) {
    throw new NotFoundError(
      "Vessel",
      vesselId !== undefined ? String(vesselId) : imo,
    );
  }

  const aggregateRow = aggregateRows[0];
  const reportCount = toNumberOrZero(aggregateRow?.report_count);
  const distanceNm = toNumberOrZero(aggregateRow?.distance_nm);
  const meRunningHours = toNumberOrZero(aggregateRow?.me_running_hours);
  const fuelConsumption = buildFuelConsumption(aggregateRow, fuelColumns);
  const fuelCoefficients = Object.fromEntries(
    resolvedFuelConfig.entries.map((entry) => [entry.type, entry.coefficient]),
  );
  const totalFuelConsumptionMt = Object.values(fuelConsumption).reduce(
    (total, value) => total + value,
    0,
  );
  const totalCo2Tonnes = calculateTotalCo2Tonnes(
    fuelConsumption,
    resolvedFuelConfig.entries,
  );
  const shipCategory = normalizeShipCategory(vessel.category);
  const categoryConfig = CATEGORY_CONFIG[shipCategory];
  const capacity = resolveDeadweight(vessel);
  const reductionFactor = getReductionFactor(reportingYear);
  const referenceLine = getReferenceLineForCategory(shipCategory, capacity);
  const referenceCii =
    referenceLine.a * Math.pow(capacity, -referenceLine.c);
  const requiredCii = referenceCii * (1 - reductionFactor / 100);
  const ratingBoundaries = {
    a_upper: requiredCii * categoryConfig.ratingThresholds.d1,
    b_upper: requiredCii * categoryConfig.ratingThresholds.d2,
    c_upper: requiredCii * categoryConfig.ratingThresholds.d3,
    d_upper: requiredCii * categoryConfig.ratingThresholds.d4,
  };

  const attainedCii =
    distanceNm > 0
      ? (totalCo2Tonnes * 1_000_000) / (capacity * distanceNm)
      : null;
  const attainedOverRequiredRatio =
    attainedCii !== null && requiredCii > 0 ? attainedCii / requiredCii : null;
  const ciiPercentage =
    attainedCii !== null && requiredCii > 0
      ? (attainedCii / requiredCii) * 100
      : null;
  const ciiRating =
    attainedOverRequiredRatio !== null
      ? getCiiRating(
          attainedOverRequiredRatio,
          categoryConfig.ratingThresholds,
        )
      : null;

  const calculationStatus =
    reportCount === 0
      ? "no_data"
      : distanceNm <= 0
        ? "insufficient_distance"
        : "calculated";
  const calculationNote =
    calculationStatus === "no_data"
      ? "No noon report records were found in the requested date range."
      : calculationStatus === "insufficient_distance"
        ? "CII rating cannot be calculated because total sailed distance is 0."
        : null;

  const ratingThresholdsNote =
    shipCategory === "Tanker" || shipCategory === "GeneralCargo"
      ? "A–E ratio bands use the same d1–d4 as bulk carriers for this ship type in this server; confirm against MEPC G4 for your ship type if required."
      : null;

  return {
    vessel: {
      id: vessel.id,
      name: vessel.name ?? null,
      imo: vessel.imo ?? null,
      category: shipCategory,
    },
    tenant: tenantName,
    period: {
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      reportingYear,
    },
    fuel_config: {
      source: resolvedFuelConfig.source,
      fuel_types: resolvedFuelConfig.entries.map((entry) => entry.type),
      fuel_co2_coefficients: fuelCoefficients,
    },
    data_summary: {
      report_count: reportCount,
      report_types: parseReportTypes(aggregateRow?.report_types ?? null),
      first_report_at: aggregateRow?.first_report_at ?? null,
      last_report_at: aggregateRow?.last_report_at ?? null,
      me_running_hours: meRunningHours,
      distance_nm: distanceNm,
      total_fuel_consumption_mt: totalFuelConsumptionMt,
      fuel_consumption_mt_by_type: fuelConsumption,
      total_co2_tonnes: totalCo2Tonnes,
    },
    cii: {
      calculation_status: calculationStatus,
      note: calculationNote,
      capacity_metric: "deadweight",
      capacity_value: capacity,
      reduction_factor_percentage: reductionFactor,
      reference_line: {
        a: referenceLine.a,
        c: referenceLine.c,
        ...(shipCategory === "GeneralCargo"
          ? { segment: capacity >= 20_000 ? "dw_ge_20000" : "dw_lt_20000" }
          : {}),
      },
      reference_cii: referenceCii,
      required_cii: requiredCii,
      attained_cii: attainedCii,
      attained_over_required_ratio: attainedOverRequiredRatio,
      cii_percentage: ciiPercentage,
      cii_rating: ciiRating,
      rating_thresholds: categoryConfig.ratingThresholds,
      rating_thresholds_note: ratingThresholdsNote,
      rating_boundaries: ratingBoundaries,
    },
  };
}

export const LIST_FLEET_VESSELS_QUERY = `
  SELECT
    s.id,
    s.name,
    s.imo,
    s.category,
    s.deadweight::double precision AS deadweight
  FROM shipping_db.ship AS s
  ORDER BY s.id ASC
`;

export type FleetVesselRow = {
  id: number;
  name: string | null;
  imo: string | null;
  category: string | null;
  deadweight: number | null;
};
