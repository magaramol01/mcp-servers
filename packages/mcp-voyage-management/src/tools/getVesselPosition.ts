import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, ValidationError } from "@mcpkit/utils";
import { actorSchema, resolveVesselId } from "./shared.js";
import type { VoyageManagementClient } from "../clients/voyageManagementClient.js";

const log = createLogger("mcp-voyage-management:get-vessel-position");

interface VoyageSummary {
  id: number | string;
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
 */
export function registerGetVesselPositionTool(server: McpServer, vms: VoyageManagementClient): void {
  server.tool(
    "get_vessel_position",
    "Return a vessel's most recently known position (from its travelled path) and recent track. Provide either a voyageId directly, or a vesselId/vesselName to resolve the vessel's most recent voyage first.",
    {
      actor: actorSchema,
      vesselId: z.number().int().optional().describe("VPM or client vessel id"),
      vesselName: z.string().trim().min(1).optional().describe("Vessel name, matched exactly (case-insensitive)"),
      voyageId: z.union([z.number().int(), z.string().trim().min(1)]).optional(),
    },
    async ({ actor, vesselId, vesselName, voyageId }) => {
      try {
        const resolvedVoyageId = voyageId ?? (await resolveVoyageId(vms, actor, vesselId, vesselName));
        const points = await vms.getTravelledPath(actor, resolvedVoyageId, 1);
        const currentPosition = points.length > 0 ? points[points.length - 1] : null;

        const payload = {
          summary: currentPosition
            ? `Most recent known position for voyage ${resolvedVoyageId} as of ${currentPosition.timestamp}.`
            : `No tracking data available yet for voyage ${resolvedVoyageId}.`,
          voyageId: resolvedVoyageId,
          currentPosition,
          recentTrack: points.slice(-20),
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

async function resolveVoyageId(
  vms: VoyageManagementClient,
  actor: Parameters<VoyageManagementClient["getTravelledPath"]>[0],
  vesselId?: number,
  vesselName?: string
): Promise<number | string> {
  if (vesselId == null && !vesselName) {
    throw new ValidationError("Provide voyageId, or vesselId/vesselName, to look up a position");
  }
  const resolvedVesselId = await resolveVesselId(vms, actor, vesselId, vesselName);
  const voyages = (await vms.listVoyagesByVessel(actor, resolvedVesselId)) as VoyageSummary[];
  if (voyages.length === 0) {
    throw new ValidationError(`No voyages found for vessel ${vesselName ?? vesselId}`);
  }
  const mostRecent = [...voyages].sort((a, b) => Number(b.id) - Number(a.id))[0]!;
  return mostRecent.id;
}
