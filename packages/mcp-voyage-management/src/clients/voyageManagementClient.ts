import type { InternalServiceClient } from "./internalServiceClient.js";
import type { Actor, ClientShip, VpmVessel } from "./types.js";

/** One point of a voyage's travelled path — same shape as VMS's `TravelledPathPoint` (`live-tracking/live-tracking.service.ts`). Passed through as-is; this package doesn't re-derive any of it. */
export interface TravelledPathPoint {
  lat: number;
  lng: number;
  timestamp: string;
  aisSpeedKn: number | null;
  aisCourseDeg: number | null;
  waveDirectionDeg: number | null;
  waveHeightM: number | null;
  swellDirectionDeg: number | null;
  swellHeightM: number | null;
  swellHeightDouglasSeaState: number | null;
  windSpeedKn: number | null;
  windDirectionDeg: number | null;
  windSpeedBeaufort: number | null;
  currentSpeedKn: number | null;
  currentDirectionDeg: number | null;
}

/**
 * Calls Voyage Management Service's real, already-built routes only —
 * verified against `Voyage-Management-Service/src/{vessels,voyages,live-tracking}/*.controller.ts`,
 * not assumed from the plan doc's aspirational description. Two real gaps
 * this surfaces, both documented at each call site below rather than
 * silently worked around:
 * 1. There is no "current position" or "fleet" endpoint — only
 *    `live-tracking/travelled-path`, keyed by `voyageId`, not `vesselId`.
 * 2. `voyages/` has no status/date-range filter and no voyage-number
 *    lookup — only `GET /voyages?vesselId=` (list) and
 *    `GET /voyages/:voyageId` (single).
 */
export class VoyageManagementClient {
  constructor(private readonly http: InternalServiceClient) {}

  /** `GET /vessels/vpm` — VPM-only vessels the actor is assigned to. */
  listVpmVessels(actor: Actor): Promise<VpmVessel[]> {
    return this.http.get<VpmVessel[]>("/vessels/vpm", actor);
  }

  /** `GET /vessels/client` — client ships the actor is assigned to. */
  listClientVessels(actor: Actor): Promise<ClientShip[]> {
    return this.http.get<ClientShip[]>("/vessels/client", actor);
  }

  /** `GET /voyages?vesselId=&isVPMOnly=` — every voyage for one vessel. No status/date filter exists server-side. */
  listVoyagesByVessel(actor: Actor, vesselId: number, isVpmOnly?: boolean): Promise<unknown[]> {
    return this.http.get<unknown[]>("/voyages", actor, { vesselId, isVPMOnly: isVpmOnly });
  }

  /** `GET /voyages/:voyageId` — single voyage lookup. */
  getVoyageById(actor: Actor, voyageId: number | string): Promise<unknown> {
    return this.http.get<unknown>(`/voyages/${encodeURIComponent(String(voyageId))}`, actor);
  }

  /** `GET /live-tracking/travelled-path?voyageId=&skip=` — ascending by timestamp; the last element is the most recent known position. */
  getTravelledPath(actor: Actor, voyageId: number | string, skip?: number): Promise<TravelledPathPoint[]> {
    return this.http.get<TravelledPathPoint[]>("/live-tracking/travelled-path", actor, {
      voyageId: String(voyageId),
      skip,
    });
  }
}
