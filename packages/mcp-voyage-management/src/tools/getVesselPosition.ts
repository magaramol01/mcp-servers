import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, ValidationError } from "@mcpkit/utils";
import { actorSchema, resolveVesselId } from "./shared.js";
import { describeArea } from "./geo.js";
import type { VoyageManagementClient, TravelledPathPoint } from "../clients/voyageManagementClient.js";

const log = createLogger("mcp-voyage-management:get-vessel-position");

/** A duration-based track request is still bounded — VMS's own current-journey/gap logic (Section 2a) already limits how far back "the current run" can go, but this is a second, explicit cap against a pathological ask (e.g. "last 5000 hours"). */
const MAX_TRACK_HOURS = 24 * 30;

interface VoyageSummary {
  id: number | string;
  voyageNumber?: string | number | null;
  [key: string]: unknown;
}

/**
 * Registers `get_vessel_position` — Plan/mcp-voyage-management-tools-plan.md
 * Section 2, tool #1.
 *
 * **Real backend constraint, not a design choice**: Voyage Management
 * Service has no "current position" or "fleet" endpoint — the only
 * position data is `GET /live-tracking/travelled-path`, keyed by
 * `voyageId`, returning a chronological point series (verified against
 * `live-tracking.controller.ts`/`.service.ts`). "Current position" here
 * means the most recent point on that series, not a live AIS feed. A true
 * live/streaming variant isn't expressible as a single MCP tool call
 * anyway (no subscription concept in the MCP tool-call protocol) — that
 * would need a different mechanism entirely, not attempted here.
 *
 * When only a vessel (not a voyage) is given, this resolves "which voyage"
 * by picking the highest-id voyage returned for that vessel — Voyage
 * Management Service exposes no "active voyage" concept yet, so this is a
 * heuristic, documented as such, not a guarantee of the vessel's actual
 * current voyage.
 *
 * Two fixes on top of the original version, both from real usage:
 * 1. Only the true latest packet is fetched by default (`limit: 1` on the
 *    VMS call) instead of the vessel's entire current-journey track
 *    downsampled client-side — the whole track was never needed just to
 *    report "where is it right now". `trackHours` opts into a bounded
 *    window of track instead, when that's actually what was asked for.
 * 2. The summary now reports the voyage's business-facing `voyageNumber`
 *    (falling back to the internal id only if VMS has no number for it)
 *    and includes the actual coordinates plus a best-effort area name —
 *    previously the summary text (the only part of the tool result Voyage
 *    Agent ever narrates back to the user — see agent-graph.service.ts's
 *    tool-result-to-response mapping) named the voyage by its raw
 *    database id and never mentioned the coordinates at all, even though
 *    they were sitting right there in `currentPosition`.
 */
export function registerGetVesselPositionTool(server: McpServer, vms: VoyageManagementClient): void {
  server.tool(
    "get_vessel_position",
    "Return a vessel's most recently known position. Provide either a voyageId directly, or a vesselId/vesselName to resolve the vessel's most recent voyage first. Set coordinatesOnly when the user explicitly asked for coordinates/lat-long/GPS position rather than a general 'where is it' question. Set trackHours only when the user asked for the recent track/route over a specific duration — otherwise only the single latest point is fetched.",
    {
      actor: actorSchema,
      vesselId: z.number().int().optional().describe("VPM or client vessel id"),
      vesselName: z.string().trim().min(1).optional().describe("Vessel name, matched exactly (case-insensitive)"),
      voyageId: z.union([z.number().int(), z.string().trim().min(1)]).optional(),
      coordinatesOnly: z
        .boolean()
        .optional()
        .describe("True only when the user explicitly asked for coordinates/lat-long/GPS position, not a general position question"),
      trackHours: z
        .number()
        .positive()
        .optional()
        .describe("Only set when the user asked for the recent track/route over a specific duration, in hours (e.g. 'last 6 hours'). Omit for a plain 'where is it now' question."),
    },
    async ({ actor, vesselId, vesselName, voyageId, coordinatesOnly, trackHours }) => {
      try {
        const { resolvedVoyageId, voyageNumber } = await resolveVoyage(vms, actor, voyageId, vesselId, vesselName);
        const voyageLabel = voyageNumber != null && voyageNumber !== "" ? String(voyageNumber) : String(resolvedVoyageId);

        const safeTrackHours =
          trackHours != null ? Math.min(trackHours, MAX_TRACK_HOURS) : undefined;

        // Only ever fetch what was actually asked for: the single latest
        // packet by default, or a bounded recent window when a duration
        // was requested — never the vessel's entire current-journey track.
        const points = await vms.getTravelledPath(
          actor,
          resolvedVoyageId,
          1,
          safeTrackHours != null ? { hours: safeTrackHours } : { limit: 1 }
        );
        const currentPosition: TravelledPathPoint | null = points.length > 0 ? points[points.length - 1]! : null;

        const area =
          currentPosition && !coordinatesOnly ? await describeArea(currentPosition.lat, currentPosition.lng) : null;

        const summary = buildSummary({
          voyageLabel,
          currentPosition,
          coordinatesOnly: coordinatesOnly ?? false,
          area,
          trackHours: safeTrackHours,
          trackPointCount: points.length,
        });

        const payload = {
          summary,
          voyageId: resolvedVoyageId,
          voyageNumber: voyageNumber ?? null,
          currentPosition,
          area,
          // Only populated for an explicit duration-based track ask — not
          // a truncated slice of a much larger fetch, the actual full
          // result for the window that was requested.
          recentTrack: safeTrackHours != null ? points : undefined,
        };

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error("get_vessel_position failed", { vesselId, vesselName, voyageId, error: error.message });
        throw error;
      }
    }
  );
}

function buildSummary(args: {
  voyageLabel: string;
  currentPosition: TravelledPathPoint | null;
  coordinatesOnly: boolean;
  area: string | null;
  trackHours?: number;
  trackPointCount: number;
}): string {
  const { voyageLabel, currentPosition, coordinatesOnly, area, trackHours, trackPointCount } = args;

  if (!currentPosition) {
    return trackHours != null
      ? `No tracking data in the last ${trackHours} hour(s) for voyage ${voyageLabel}.`
      : `No tracking data available yet for voyage ${voyageLabel}.`;
  }

  const lat = currentPosition.lat.toFixed(4);
  const lng = currentPosition.lng.toFixed(4);
  const timestamp = currentPosition.timestamp;

  if (coordinatesOnly) {
    return `Lat ${lat}, Lng ${lng}, as of ${timestamp}.`;
  }

  const areaClause = area ? ` (near ${area})` : "";

  if (trackHours != null) {
    return (
      `Voyage ${voyageLabel}'s track over the last ${trackHours} hour(s): ${trackPointCount} point(s). ` +
      `Most recent position ${lat}, ${lng}${areaClause}, as of ${timestamp}.`
    );
  }

  return `Voyage ${voyageLabel}'s most recent known position is ${lat}, ${lng}${areaClause}, as of ${timestamp}.`;
}

async function resolveVoyage(
  vms: VoyageManagementClient,
  actor: Parameters<VoyageManagementClient["getTravelledPath"]>[0],
  voyageId: number | string | undefined,
  vesselId: number | undefined,
  vesselName: string | undefined
): Promise<{ resolvedVoyageId: number | string; voyageNumber: string | number | null }> {
  if (voyageId != null) {
    // Display-only lookup for the voyage number — never fails the tool
    // call itself if it can't be resolved; the caller still gets a
    // working position, just labelled by voyageId as a fallback.
    try {
      const voyage = (await vms.getVoyageById(actor, voyageId)) as VoyageSummary;
      return { resolvedVoyageId: voyageId, voyageNumber: voyage?.voyageNumber ?? null };
    } catch (err) {
      log.warn("could not resolve voyageNumber for display, falling back to voyageId", {
        voyageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { resolvedVoyageId: voyageId, voyageNumber: null };
    }
  }

  if (vesselId == null && !vesselName) {
    throw new ValidationError("Provide voyageId, or vesselId/vesselName, to look up a position");
  }
  const resolvedVesselId = await resolveVesselId(vms, actor, vesselId, vesselName);
  const voyages = (await vms.listVoyagesByVessel(actor, resolvedVesselId)) as VoyageSummary[];
  if (voyages.length === 0) {
    throw new ValidationError(`No voyages found for vessel ${vesselName ?? vesselId}`);
  }
  const mostRecent = [...voyages].sort((a, b) => Number(b.id) - Number(a.id))[0]!;
  return { resolvedVoyageId: mostRecent.id, voyageNumber: mostRecent.voyageNumber ?? null };
}
