import { toError, ValidationError } from "@mcpkit/utils";

/** PostgreSQL: invalid_catalog_name */
const PG_INVALID_CATALOG = "3D000";
/** PostgreSQL: undefined_table */
const PG_UNDEFINED_TABLE = "42P01";

/**
 * Map common PostgreSQL errors to short agent-actionable messages.
 * Other errors pass through {@link toError}.
 */
export function toAgentFriendlyDbError(err: unknown): Error {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);

    if (code === PG_INVALID_CATALOG) {
      return new ValidationError(
        "Tenant database not found: confirm `tenant` matches a PostgreSQL database name that exists on this server.",
      );
    }

    if (code === PG_UNDEFINED_TABLE) {
      return new ValidationError(
        "A required table or view is missing; this deployment may not include the expected shipping_db schema.",
      );
    }
  }

  return toError(err);
}
