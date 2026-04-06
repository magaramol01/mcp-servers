import { ValidationError } from "@mcpkit/utils";

const ISO_DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeVesselId(vesselId?: string): number | undefined {
  if (vesselId === undefined || vesselId === "") {
    return undefined;
  }

  const normalizedVesselId = Number.parseInt(vesselId, 10);

  if (Number.isNaN(normalizedVesselId) || normalizedVesselId <= 0) {
    throw new ValidationError("vesselId must be a positive integer");
  }

  return normalizedVesselId;
}

export function resolveTenantName(tenant?: string): string {
  const normalizedTenant = tenant?.trim();

  if (!normalizedTenant) {
    throw new ValidationError("tenant is required");
  }

  return normalizedTenant;
}

export function getTenantPostgresUrl(basePostgresUrl: string, tenant: string): string {
  const normalizedTenant = tenant.trim();

  if (!normalizedTenant) {
    throw new ValidationError("tenant is required");
  }

  if (
    normalizedTenant.includes("/") ||
    normalizedTenant.includes("?") ||
    normalizedTenant.includes("#")
  ) {
    throw new ValidationError("tenant must be a valid database name");
  }

  const tenantPostgresUrl = new URL(basePostgresUrl);
  tenantPostgresUrl.pathname = `/${normalizedTenant}`;
  return tenantPostgresUrl.toString();
}

export function normalizeIsoDateInput(label: string, value: string): string {
  const normalizedValue = value.trim();

  if (!ISO_DATE_INPUT_REGEX.test(normalizedValue)) {
    throw new ValidationError(`${label} must be in YYYY-MM-DD format`);
  }

  const parsed = new Date(`${normalizedValue}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalizedValue
  ) {
    throw new ValidationError(`${label} must be a valid calendar date`);
  }

  return normalizedValue;
}

export function getReportingYear(startDate: string, endDate: string): number {
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);

  if (startYear !== endYear) {
    throw new ValidationError(
      "startDate and endDate must be in the same calendar year",
    );
  }

  return Number.parseInt(startYear, 10);
}
