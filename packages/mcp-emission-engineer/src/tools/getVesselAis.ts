import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  connectPostgres,
  createLogger,
  NotFoundError,
  requireEnv,
  toError,
  ValidationError,
} from "@mcpkit/utils";

const log = createLogger("mcp-emission-engineer:get-vessel-ais");

const GET_VESSEL_AIS_QUERY = `
  SELECT
    s.name,
    s.imo,
    latest.packetts::text AS ts,
    CASE
      WHEN latest.lat IS NULL THEN NULL
      WHEN UPPER(COALESCE(latest.nmeadata->>'latDirection', 'N')) = 'S'
        THEN -ABS(latest.lat::double precision)
      ELSE ABS(latest.lat::double precision)
    END AS lat,
    CASE
      WHEN latest."long" IS NULL THEN NULL
      WHEN UPPER(COALESCE(latest.nmeadata->>'longDirection', 'E')) = 'W'
        THEN -ABS(latest."long"::double precision)
      ELSE ABS(latest."long"::double precision)
    END AS lon,
    NULLIF(latest.nmeadata->>'sog', '')::double precision AS sog,
    NULLIF(
      COALESCE(
        latest.nmeadata->>'currentVesselCourse',
        latest.nmeadata->>'vesselHeading'
      ),
      ''
    )::double precision AS cog,
    COALESCE(
      latest.nmeadata->>'navStatus',
      latest.nmeadata->>'navigationStatus'
    ) AS nav_status
  FROM shipping_db.ship AS s
  LEFT JOIN LATERAL (
    SELECT *
    FROM shipping_db.std_stormglassweather AS w
    WHERE w.vesselid = s.id
    ORDER BY w.packetts DESC, w.id DESC
    LIMIT 1
  ) AS latest ON TRUE
  WHERE ($1::integer IS NULL OR s.id = $1)
    AND ($2::text IS NULL OR s.imo = $2)
  ORDER BY s.id ASC
  LIMIT 1
`;

function normalizeVesselId(vesselId?: string): number | undefined {
  if (vesselId === undefined || vesselId === "") {
    return undefined;
  }

  const normalizedVesselId = Number.parseInt(vesselId, 10);

  if (Number.isNaN(normalizedVesselId) || normalizedVesselId <= 0) {
    throw new ValidationError("vesselId must be a positive integer");
  }

  return normalizedVesselId;
}

export function registerGetVesselAisTool(server: McpServer): void {
  server.tool(
    "get_vessel_ais",
    "Return the latest AIS position for a vessel using either vesselId or IMO",
    {
      vesselId: z
        .string()
        .trim()
        .optional()
        .describe("Internal vessel id from shipping_db.ship.id"),
      imo: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Vessel IMO number from shipping_db.ship.imo"),
    },
    async ({ vesselId, imo }) => {
      const postgresUrl = requireEnv("EMISSION_ENGINEER_POSTGRES_URL");
      let normalizedVesselId: number | undefined;

      try {
        if (vesselId === undefined && imo === undefined) {
          throw new ValidationError("Provide either vesselId or imo");
        }

        normalizedVesselId = normalizeVesselId(vesselId);

        const pool = await connectPostgres(postgresUrl);
        const { rows } = await pool.query(GET_VESSEL_AIS_QUERY, [
          normalizedVesselId ?? null,
          imo ?? null,
        ]);

        const vessel = rows[0];

        if (!vessel) {
          throw new NotFoundError(
            "Vessel",
            normalizedVesselId !== undefined ? String(normalizedVesselId) : imo,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  name: vessel.name ?? null,
                  imo: vessel.imo ?? null,
                  ts: vessel.ts ?? null,
                  lat: vessel.lat ?? null,
                  lon: vessel.lon ?? null,
                  sog: vessel.sog ?? null,
                  cog: vessel.cog ?? null,
                  nav_status: vessel.nav_status ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const error = toError(err);
        log.error("get_vessel_ais failed", {
          vesselId: normalizedVesselId,
          imo,
          error: error.message,
        });
        throw error;
      }
    },
  );
}
