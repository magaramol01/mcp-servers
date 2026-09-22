import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, ValidationError } from "@mcpkit/utils";
import { actorSchema, resolveVesselId } from "./shared.js";
import type { VoyageManagementClient } from "../clients/voyageManagementClient.js";

const log = createLogger("mcp-voyage-management:query-voyages");

/**
 * Registers `query_voyages` — Plan/mcp-voyage-management-tools-plan.md
 * Section 2, tool #2.
 *
 * **Real backend constraint**: Voyage Management Service's `voyages/`
 * module (verified against `voyages.controller.ts`) only supports two
 * lookups — `GET /voyages?vesselId=` (every voyage for one vessel) and
 * `GET /voyages/:voyageId` (one voyage by id). There is no `status`,
 * `dateRange`, or `voyageNumber` filter server-side. `status`/`dateRange`
 * params are accepted here for forward-compatibility with
 * Voyage-Agent's `tool-registry.ts` (which already sends them) but are
 * **not applied** — the response says so explicitly rather than silently
 * ignoring them, so a caller doesn't mistake an unfiltered list for a
 * filtered one.
 */
export function registerQueryVoyagesTool(server: McpServer, vms: VoyageManagementClient): void {
  server.tool(
    "query_voyages",
    "Look up a single voyage by id, or list every voyage for a vessel. Status/date-range filtering is not supported by Voyage Management Service yet — results are unfiltered when provided.",
    {
      actor: actorSchema,
      voyageId: z.union([z.number().int(), z.string().trim().min(1)]).optional(),
      voyageNumber: z.string().trim().min(1).optional().describe("Not supported server-side yet — ignored if provided"),
      vesselId: z.number().int().optional(),
      vesselName: z.string().trim().min(1).optional(),
      status: z.string().trim().min(1).optional().describe("Not applied server-side yet — see this tool's description"),
      dateRange: z
        .object({ from: z.string().trim().min(1).optional(), to: z.string().trim().min(1).optional() })
        .optional()
        .describe("Not applied server-side yet — see this tool's description"),
      isVpmOnly: z.boolean().optional(),
    },
    async ({ actor, voyageId, voyageNumber, vesselId, vesselName, status, dateRange, isVpmOnly }) => {
      try {
        if (voyageId != null) {
          const voyage = await vms.getVoyageById(actor, voyageId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ summary: `Voyage ${voyageId}.`, voyage }, null, 2),
              },
            ],
          };
        }

        if (vesselId == null && !vesselName) {
          throw new ValidationError("Provide voyageId, or vesselId/vesselName, to look up voyages");
        }

        const resolvedVesselId = await resolveVesselId(vms, actor, vesselId, vesselName);
        const voyages = await vms.listVoyagesByVessel(actor, resolvedVesselId, isVpmOnly);

        const unappliedFilters = [
          voyageNumber ? "voyageNumber" : null,
          status ? "status" : null,
          dateRange ? "dateRange" : null,
        ].filter(Boolean);

        const payload = {
          summary:
            unappliedFilters.length > 0
              ? `${voyages.length} voyage(s) for this vessel (${unappliedFilters.join(", ")} not supported server-side — unfiltered).`
              : `${voyages.length} voyage(s) for this vessel.`,
          voyages,
        };

        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error("query_voyages failed", { voyageId, vesselId, vesselName, error: error.message });
        throw error;
      }
    }
  );
}
