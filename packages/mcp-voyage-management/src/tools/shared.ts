import { z } from "zod";
import { NotFoundError, ValidationError } from "@mcpkit/utils";
import type { VoyageManagementClient } from "../clients/voyageManagementClient.js";
import type { Actor } from "../clients/types.js";

/**
 * Every tool in this package requires `actor` — Voyage Agent's own
 * verified identity, forwarded unchanged (Plan/mcp-voyage-management-tools-plan.md
 * Section 1). This is input **validation** (shape/non-empty), not identity
 * **verification** — trust comes from `x-internal-gateway-key`, not from
 * anything this schema checks.
 */
export const actorSchema = z.object({
  userId: z.string().trim().min(1),
  email: z.string().trim().min(1),
  role: z.string().optional().default(""),
  companyName: z.string().trim().min(1),
});

/**
 * Resolves a vessel reference to a VPM vessel id, checking both the
 * VPM-only and client-ship lists (same two lists Voyage Agent's own
 * `vessel-access-gate.service.ts` already checked the actor against
 * before this tool was ever called — Section 6's "tools trust
 * checkAccess's verdict" rule). Matching by name is case-insensitive,
 * exact match only — no fuzzy matching, so an ambiguous or misspelled
 * name fails loudly via `NotFoundError` rather than guessing.
 */
export async function resolveVesselId(
  vms: VoyageManagementClient,
  actor: Actor,
  vesselId?: number,
  vesselName?: string
): Promise<number> {
  if (vesselId != null) {
    return vesselId;
  }
  if (!vesselName) {
    throw new ValidationError("vesselId or vesselName is required");
  }

  const [vpmVessels, clientShips] = await Promise.all([
    vms.listVpmVessels(actor),
    vms.listClientVessels(actor),
  ]);
  const normalized = vesselName.trim().toLowerCase();
  const match =
    vpmVessels.find((v) => v.name.trim().toLowerCase() === normalized) ??
    clientShips.find((s) => s.name.trim().toLowerCase() === normalized);

  if (!match) {
    throw new NotFoundError("vessel", vesselName);
  }
  return match.id;
}
