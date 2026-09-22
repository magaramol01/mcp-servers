import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger, ValidationError } from "@mcpkit/utils";
import { actorSchema } from "./shared.js";
import { REPORT_TYPES, type ReportsAgentClient } from "../clients/reportsAgentClient.js";

const log = createLogger("mcp-voyage-management:reports-agent");

const waypointSchema = z.object({ lat: z.number(), lng: z.number() });

/**
 * Registers `reports_agent` — Plan/mcp-voyage-management-tools-plan.md
 * Section 2, tool #3. One tool, two actions (`generate`/`open`), same
 * split as the plan's Section 6a. **Confirmation for `generate` already
 * happened in Voyage Agent before this tool is ever called** (Section 1's
 * "no confirmation-gating here" convention) — this handler does not gate
 * anything itself.
 *
 * `generate`'s body requirement differs by `reportType`, verified against
 * each report type's real `class-validator` DTO in Reports Agent:
 * - `EOV` / `PORT_WEATHER` / `VPA`: `voyageId` (+ optional `vesselId`).
 * - `TROPICAL_STORM`: adds a required `stormId`.
 * - `PASSAGE_WEATHER`: additionally needs `waypoints`/`avgSpeedKts`/
 *   `departureTime`/`intervalHrs`/`days` — route geometry Voyage Agent's
 *   current entity extraction does not produce from a plain chat message.
 *   This tool still accepts and forwards these fields when given (e.g. a
 *   caller that already resolved a route); if they're missing, Reports
 *   Agent's own DTO validation rejects with a clear 400, surfaced here as
 *   a `ValidationError` — not guessed or defaulted in this package.
 */
export function registerReportsAgentTool(server: McpServer, reportsAgent: ReportsAgentClient): void {
  server.tool(
    "reports_agent",
    "Generate a new report, or open/list already-generated reports, for one of Reports Agent's 5 report types (EOV, PASSAGE_WEATHER, PORT_WEATHER, TROPICAL_STORM, VPA).",
    {
      actor: actorSchema,
      action: z.enum(["generate", "open"]),
      reportType: z.enum(REPORT_TYPES).optional(),
      reportId: z.number().int().optional().describe("Open a specific generated report by its id"),
      voyageId: z.number().int().optional(),
      vesselId: z.number().int().optional(),
      stormId: z.string().trim().min(1).optional().describe("Required when reportType is TROPICAL_STORM"),
      waypoints: z.array(waypointSchema).optional().describe("Required when reportType is PASSAGE_WEATHER"),
      avgSpeedKts: z.number().positive().optional(),
      departureTime: z.string().trim().min(1).optional(),
      intervalHrs: z.number().positive().optional(),
      days: z.number().positive().optional(),
    },
    async (input) => {
      try {
        const payload = input.action === "generate" ? await handleGenerate(reportsAgent, input) : await handleOpen(reportsAgent, input);
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error("reports_agent failed", { action: input.action, reportType: input.reportType, error: error.message });
        throw error;
      }
    }
  );
}

type ReportsAgentToolInput = {
  actor: z.infer<typeof actorSchema>;
  action: "generate" | "open";
  reportType?: (typeof REPORT_TYPES)[number];
  reportId?: number;
  voyageId?: number;
  vesselId?: number;
  stormId?: string;
  waypoints?: Array<{ lat: number; lng: number }>;
  avgSpeedKts?: number;
  departureTime?: string;
  intervalHrs?: number;
  days?: number;
};

async function handleGenerate(reportsAgent: ReportsAgentClient, input: ReportsAgentToolInput) {
  if (!input.reportType) {
    throw new ValidationError("reportType is required to generate a report");
  }
  if (input.voyageId == null) {
    throw new ValidationError("voyageId is required to generate a report");
  }

  const body: Record<string, unknown> = { voyageId: input.voyageId, vesselId: input.vesselId };

  if (input.reportType === "TROPICAL_STORM") {
    body.stormId = input.stormId;
  }
  if (input.reportType === "PASSAGE_WEATHER") {
    body.waypoints = input.waypoints;
    body.avgSpeedKts = input.avgSpeedKts;
    body.departureTime = input.departureTime;
    body.intervalHrs = input.intervalHrs;
    body.days = input.days;
  }

  const report = await reportsAgent.generate(input.actor, input.reportType, body);
  return { summary: `Generated a ${input.reportType} report for voyage ${input.voyageId}.`, report };
}

async function handleOpen(reportsAgent: ReportsAgentClient, input: ReportsAgentToolInput) {
  if (input.reportId != null) {
    const report = await reportsAgent.getById(input.actor, input.reportId);
    return { summary: `Report ${input.reportId}.`, report };
  }

  if (input.voyageId == null || !input.reportType) {
    throw new ValidationError("Provide reportId, or voyageId + reportType, to open a report");
  }

  const reports = await reportsAgent.listByVoyageAndType(input.actor, input.voyageId, input.reportType);
  return {
    summary: `${reports.length} ${input.reportType} report(s) for voyage ${input.voyageId}.`,
    reports,
  };
}
