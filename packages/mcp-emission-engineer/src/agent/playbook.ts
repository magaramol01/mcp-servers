import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FUEL_TYPE_ALIASES,
  KNOWN_FUEL_CANONICAL_KEYS,
} from "../accounting/ipccFactors.js";
import tenantConf from "../conf/conf.json";

const PLAYBOOK_URI = "emission-engineer://playbook";

function buildPlaybookPayload(): Record<string, unknown> {
  const tenants = tenantConf.tenants;
  const tenantNames =
    tenants && typeof tenants === "object"
      ? Object.keys(tenants as Record<string, unknown>).sort((a, b) => a.localeCompare(b))
      : [];

  const aliasPairs = Object.entries(FUEL_TYPE_ALIASES)
    .filter(([k, v]) => k !== v)
    .sort(([a], [b]) => a.localeCompare(b));

  return {
    server: "mcpkit/mcp-emission-engineer",
    environment: {
      requiredAtStartup: ["EMISSION_ENGINEER_POSTGRES_URL"],
      optional: ["EMISSION_ENGINEER_HOST", "EMISSION_ENGINEER_PORT", "HOST", "PORT"],
      tenantMeaning:
        "The `tenant` tool argument is the PostgreSQL database name (single path segment). The server opens a connection to `…/tenant` derived from EMISSION_ENGINEER_POSTGRES_URL.",
    },
    tenants: {
      configuredInBundledConf: tenantNames,
      note: "Additional tenant databases may exist on the server; conf lists fuel-tag mappings used by CII for those tenants.",
    },
    fuelTypes: {
      canonical: [...KNOWN_FUEL_CANONICAL_KEYS],
      aliases: Object.fromEntries(aliasPairs),
    },
    workflows: [
      {
        goal: "CII rating for one vessel",
        steps: [
          "validate_noon_report_series (optional) — data quality",
          "trace_cii_calculation_inputs — deduped rows and fuel tags",
          "calculate_cii_rating — attained/required and A–E",
        ],
      },
      {
        goal: "Fleet CII overview",
        steps: ["fleet_cii_summary — same engine as calculate_cii_rating, many vessels; use compact:true to shrink output"],
      },
      {
        goal: "Verifier / internal audit package",
        steps: ["export_mrv_audit_bundle — JSON bundle (not THETIS upload)"],
      },
      {
        goal: "Emissions from fuel masses (no DB)",
        steps: ["calculate_emissions_from_fuel"],
      },
    ],
    toolsByDomain: {
      ciiAndMrv: [
        "calculate_cii_rating",
        "fleet_cii_summary",
        "trace_cii_calculation_inputs",
        "validate_noon_report_series",
        "export_mrv_audit_bundle",
        "aggregate_emissions_by_voyage",
      ],
      eu: [
        "estimate_eu_ets_obligation",
        "reconcile_eua_purchases",
        "fuelyeu_indicative_compliance",
        "get_ets_delegation_checklist",
      ],
      other: ["calculate_emissions_from_fuel", "classify_emissions_by_scope", "get_vessel_ais"],
    },
    resources: {
      playbookUri: PLAYBOOK_URI,
      note: "Read this URI via MCP resources/read for the same JSON as get_emission_engineer_playbook.",
    },
  };
}

export function getPlaybookJsonText(): string {
  return JSON.stringify(buildPlaybookPayload(), null, 2);
}

export const MCP_SERVER_INSTRUCTIONS = [
  "Emission-engineer MCP: maritime CII/MRV-style calculations and EU regulatory helpers.",
  "Requires env EMISSION_ENGINEER_POSTGRES_URL at process startup. Tool argument `tenant` selects the PostgreSQL database (name = one path segment).",
  "For tool choice and fuel keys, call get_emission_engineer_playbook or read resource emission-engineer://playbook.",
  "Outputs are indicative unless your organization has verified them; several tools state legal/MRV limits in their descriptions.",
].join("\n");

export function registerAgentPlaybookSurface(server: McpServer): void {
  const text = getPlaybookJsonText();

  server.registerResource(
    "emission_engineer_playbook",
    PLAYBOOK_URI,
    {
      description:
        "Machine-readable workflows, env vars, tenant hints, and canonical fuel keys for this server",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text,
        },
      ],
    }),
  );

  server.tool(
    "get_emission_engineer_playbook",
    "Return JSON with recommended tool workflows, required environment variables, tenant semantics, bundled conf tenant names, and canonical fuel keys (same content as resource emission-engineer://playbook).",
    {},
    async () => ({
      content: [{ type: "text", text }],
    }),
  );
}
