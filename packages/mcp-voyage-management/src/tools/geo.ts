import { createLogger } from "@mcpkit/utils";

const log = createLogger("mcp-voyage-management:reverse-geocode");

const REVERSE_GEOCODE_TIMEOUT_MS = 4000;

/**
 * Best-effort "what area is this coordinate in" for a vessel position
 * summary — never required for `get_vessel_position`'s response to still
 * be useful (VMS itself has no maritime-area concept; Section 2a). Uses
 * OpenStreetMap's public Nominatim reverse endpoint (no API key), one
 * lookup per position query, short timeout. Any failure — network, rate
 * limit, or simply no result (expected for open ocean, where Nominatim
 * has nothing administrative to return) — degrades to `null` rather than
 * failing the tool call; the caller still has the raw coordinates.
 */
export async function describeArea(lat: number, lng: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "5");

    const response = await fetch(url, {
      signal: controller.signal,
      // Nominatim's usage policy requires an identifying User-Agent for
      // any non-browser client.
      headers: { "User-Agent": "mcp-voyage-management/1.0 (VPM 2.0 internal tool)" },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };
    const address = data.address ?? {};
    return (
      address.sea ??
      address.ocean ??
      address.body_of_water ??
      address.country ??
      data.name ??
      data.display_name ??
      null
    );
  } catch (err) {
    log.warn("reverse geocode lookup failed, omitting area", {
      lat,
      lng,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
