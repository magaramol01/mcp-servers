import { MongoClient, Db } from "mongodb";
import { createLogger } from "./logger.js";

const log = createLogger("mongodb");

let _client: MongoClient | null = null;

/**
 * Returns a singleton MongoDB client. Creates and connects on first call.
 * Call `disconnectMongo()` during graceful shutdown.
 */
export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  if (!_client) {
    log.info("Connecting to MongoDB...", { dbName });
    _client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS: 30_000,
    });
    await _client.connect();
    log.info("MongoDB connected", { dbName });
  }
  return _client.db(dbName);
}

/**
 * Gracefully closes the MongoDB connection.
 */
export async function disconnectMongo(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
    log.info("MongoDB disconnected");
  }
}
