import { ValidationError } from "@mcpkit/utils";
import type { InternalServiceClient } from "./internalServiceClient.js";
import type { Actor } from "./types.js";

/**
 * The 5 report types Reports Agent exposes, and the `reportType` value
 * `generated_reports` rows are actually stored under — verified against
 * each `reports/<type>/*.service.ts`'s literal `reportType:` field, not
 * assumed. **Tropical Storm is the one exception**: it persists to its own
 * `tropical_warning_reports` table, not `generated_reports`
 * (`tropical-storm.service.ts`), and its controller only exposes
 * `POST generate` — no retrieval route exists for it yet. `openReport`
 * below refuses that combination explicitly rather than calling a route
 * that doesn't exist.
 */
export const REPORT_TYPES = ["EOV", "PASSAGE_WEATHER", "PORT_WEATHER", "TROPICAL_STORM", "VPA"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const GENERATE_PATH_BY_REPORT_TYPE: Record<ReportType, string> = {
  EOV: "/reports/end-of-voyage/generate",
  PASSAGE_WEATHER: "/reports/passage-weather/generate",
  PORT_WEATHER: "/reports/port-weather/generate",
  TROPICAL_STORM: "/reports/tropical-storm/generate",
  VPA: "/reports/voyage-performance-analysis/generate",
};

export class ReportsAgentClient {
  constructor(private readonly http: InternalServiceClient) {}

  /**
   * `POST /reports/<type>/generate`. `body` must match that report type's
   * own DTO — verified per type:
   * - EOV / PORT_WEATHER / VPA: `{ voyageId, vesselId? }`
   * - TROPICAL_STORM: `{ voyageId, vesselId?, stormId }`
   * - PASSAGE_WEATHER: `{ voyageId, vesselId?, waypoints, avgSpeedKts, departureTime, intervalHrs, days }`
   *   — this one needs route geometry Voyage Agent's current entity
   *   extraction does not produce yet (see this file's callers). Reports
   *   Agent's own `class-validator` DTOs are the actual source of truth for
   *   what's required — a missing field here surfaces as a `ValidationError`
   *   from Reports Agent itself, not a guess made in this package.
   */
  generate(actor: Actor, reportType: ReportType, body: Record<string, unknown>): Promise<unknown> {
    const path = GENERATE_PATH_BY_REPORT_TYPE[reportType];
    return this.http.post(path, actor, body);
  }

  /** `GET /generated-reports/:id` — by the `generated_reports` row's own id. */
  getById(actor: Actor, id: number): Promise<unknown> {
    return this.http.get(`/generated-reports/${encodeURIComponent(String(id))}`, actor);
  }

  /** `GET /generated-reports?voyageId=&reportType=` — every report of one type generated for one voyage. Refuses `TROPICAL_STORM` — see this class's file doc. */
  listByVoyageAndType(actor: Actor, voyageId: number, reportType: ReportType): Promise<unknown[]> {
    if (reportType === "TROPICAL_STORM") {
      throw new ValidationError(
        "Opening an existing Tropical Storm report isn't supported yet — Reports Agent has no retrieval route for it (generate-only)."
      );
    }
    return this.http.get<unknown[]>("/generated-reports", actor, { voyageId, reportType });
  }
}
