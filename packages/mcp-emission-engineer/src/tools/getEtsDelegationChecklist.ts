import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ETS_DELEGATION_CHECKLIST } from "../eu/etsDelegationChecklist.js";

export function registerGetEtsDelegationChecklistTool(server: McpServer): void {
  server.tool(
    "get_ets_delegation_checklist",
    "Return a static JSON checklist for aligning EU ETS / MRV roles (owner, DOC, charterer) — not legal advice.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(ETS_DELEGATION_CHECKLIST, null, 2),
        },
      ],
    }),
  );
}
