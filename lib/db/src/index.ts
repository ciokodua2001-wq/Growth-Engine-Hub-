import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { assertDatabaseTarget } from "./targetGuard";

assertDatabaseTarget(process.env);

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "10", 10),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export {
  assertDatabaseTarget,
  assertConnectedDatabaseIdentity,
  NIGERIA_STAGING_DATABASE_NAME,
  type ConnectedDatabaseIdentity,
} from "./targetGuard";
