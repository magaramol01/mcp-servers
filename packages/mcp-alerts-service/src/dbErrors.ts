import { toError, ValidationError } from "@mcpkit/utils";

const PG_INVALID_CATALOG = "3D000";
const PG_INVALID_SCHEMA = "3F000";
const PG_UNDEFINED_TABLE = "42P01";
const PG_UNDEFINED_COLUMN = "42703";

export function toAgentFriendlyDbError(err: unknown): Error {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);

    if (code === PG_INVALID_CATALOG) {
      return new ValidationError(
        "Tenant database not found: confirm `tenant` matches a PostgreSQL database name that exists on this server.",
      );
    }

    if (code === PG_INVALID_SCHEMA || code === PG_UNDEFINED_TABLE) {
      return new ValidationError(
        "A required Rule Engine table is missing; confirm the tenant database exposes std_ruleblocks, std_ruleconfigs, standardparameters, std_triggeredoutcomestoday, std_triggeredoutcomeshistory, and ship in shipping_db.",
      );
    }

    if (code === PG_UNDEFINED_COLUMN) {
      return new ValidationError(
        "One or more Rule Engine tables is missing required columns expected by this MCP service.",
      );
    }
  }

  return toError(err);
}
