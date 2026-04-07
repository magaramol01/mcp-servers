import { ValidationError } from "@mcpkit/utils";

const PG_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveTenantName(tenant?: string): string {
  const normalizedTenant = tenant?.trim();

  if (!normalizedTenant) {
    throw new ValidationError("tenant is required");
  }

  return normalizedTenant;
}

export function getTenantPostgresUrl(basePostgresUrl: string, tenant: string): string {
  const normalizedTenant = resolveTenantName(tenant);

  if (
    normalizedTenant.includes("/") ||
    normalizedTenant.includes("?") ||
    normalizedTenant.includes("#")
  ) {
    throw new ValidationError("tenant must be a valid PostgreSQL database name");
  }

  const tenantPostgresUrl = new URL(basePostgresUrl);
  tenantPostgresUrl.pathname = `/${normalizedTenant}`;
  return tenantPostgresUrl.toString();
}

export function normalizeIdentifier(label: string, value: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ValidationError(`${label} is required`);
  }

  if (!PG_IDENTIFIER_REGEX.test(normalizedValue)) {
    throw new ValidationError(`${label} must be a valid PostgreSQL identifier`);
  }

  return normalizedValue;
}

export function qualifyTableName(schemaName: string, tableName: string): string {
  return `${normalizeIdentifier("schema", schemaName)}.${normalizeIdentifier("table", tableName)}`;
}

export function normalizeTimestampInput(
  label: string,
  value?: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ValidationError(`${label} is required`);
  }

  const parsed = new Date(normalizedValue);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${label} must be a valid ISO-8601 timestamp`);
  }

  return parsed.toISOString();
}

export function parseRuleRefs(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value !== "string") {
    return [String(value)];
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalizedValue);

    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
  } catch {
    // Fall back to comma-separated parsing below.
  }

  return normalizedValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
