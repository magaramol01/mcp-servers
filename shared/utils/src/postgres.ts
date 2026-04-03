import { Pool, type PoolConfig } from "pg";
import { createLogger } from "./logger.js";

const log = createLogger("postgres");

let _pool: Pool | null = null;

function toPoolConfig(config: string | PoolConfig): PoolConfig {
  return typeof config === "string" ? { connectionString: config } : config;
}

/**
 * Returns a singleton PostgreSQL pool. Creates and validates it on first call.
 * Call `disconnectPostgres()` during graceful shutdown.
 */
export async function connectPostgres(config: string | PoolConfig): Promise<Pool> {
  if (!_pool) {
    const poolConfig = {
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ...toPoolConfig(config),
    };

    log.info("Connecting to PostgreSQL...", {
      database: poolConfig.database,
      host: poolConfig.host,
      port: poolConfig.port,
    });

    _pool = new Pool(poolConfig);
    _pool.on("error", (error: Error) => {
      log.error("Unexpected PostgreSQL pool error", { error: error.message });
    });

    const client = await _pool.connect();
    client.release();

    log.info("PostgreSQL connected", {
      database: poolConfig.database,
      host: poolConfig.host,
      port: poolConfig.port,
    });
  }

  return _pool;
}

/**
 * Gracefully closes the PostgreSQL pool.
 */
export async function disconnectPostgres(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    log.info("PostgreSQL disconnected");
  }
}
