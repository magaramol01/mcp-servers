/**
 * Reads a required environment variable. Throws at startup if missing.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Reads an optional environment variable with a typed default.
 */
export function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Reads an environment variable as an integer.
 */
export function requireEnvInt(key: string): number {
  const raw = requireEnv(key);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  return parsed;
}

/**
 * Reads an environment variable as a boolean.
 * Accepts: "true", "1", "yes" → true. Everything else → false.
 */
export function requireEnvBool(key: string): boolean {
  const raw = requireEnv(key).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
