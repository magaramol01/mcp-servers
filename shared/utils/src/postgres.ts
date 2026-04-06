import { Pool, type PoolConfig } from "pg";
import { createLogger } from "./logger.js";

const log = createLogger("postgres");

const pools = new Map<string, Pool>();

function toPoolConfig(config: string | PoolConfig): PoolConfig {
  return typeof config === "string" ? { connectionString: config } : config;
}

function toNormalizedPoolConfig(config: string | PoolConfig): PoolConfig {
  return {
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ...toPoolConfig(config),
  };
}

function getPoolKey(poolConfig: PoolConfig): string {
  if (poolConfig.connectionString) {
    return poolConfig.connectionString;
  }

  return JSON.stringify({
    host: poolConfig.host ?? null,
    port: poolConfig.port ?? null,
    database: poolConfig.database ?? null,
    user: poolConfig.user ?? null,
    password: poolConfig.password ?? null,
    ssl: poolConfig.ssl ?? null,
  });
}

/**
 * Returns a PostgreSQL pool for the given config and reuses it across calls.
 * Call `disconnectPostgres()` during graceful shutdown.
 */
export async function connectPostgres(config: string | PoolConfig): Promise<Pool> {
  const poolConfig = toNormalizedPoolConfig(config);
  const poolKey = getPoolKey(poolConfig);
  const existingPool = pools.get(poolKey);

  if (existingPool) {
    return existingPool;
  }

  log.info("Connecting to PostgreSQL...", {
    database: poolConfig.database,
    host: poolConfig.host,
    port: poolConfig.port,
  });

  const pool = new Pool(poolConfig);
  pool.on("error", (error: Error) => {
    log.error("Unexpected PostgreSQL pool error", { error: error.message });
  });

  try {
    const client = await pool.connect();
    client.release();

    pools.set(poolKey, pool);

    log.info("PostgreSQL connected", {
      database: poolConfig.database,
      host: poolConfig.host,
      port: poolConfig.port,
    });
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  return pool;
}

/**
 * Gracefully closes PostgreSQL pools. When config is omitted, all pools are closed.
 */
export async function disconnectPostgres(config?: string | PoolConfig): Promise<void> {
  if (config) {
    const poolConfig = toNormalizedPoolConfig(config);
    const poolKey = getPoolKey(poolConfig);
    const pool = pools.get(poolKey);

    if (pool) {
      await pool.end();
      pools.delete(poolKey);
      log.info("PostgreSQL disconnected", {
        database: poolConfig.database,
        host: poolConfig.host,
        port: poolConfig.port,
      });
    }

    return;
  }

  const activePools = Array.from(pools.entries());
  pools.clear();

  await Promise.all(
    activePools.map(async ([, pool]) => {
      await pool.end();
    }),
  );

  if (activePools.length > 0) {
    log.info("PostgreSQL disconnected");
  }
}
