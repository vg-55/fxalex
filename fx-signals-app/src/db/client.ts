import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Enable connection caching for serverless environments
neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Soft-warn at import time so dev mode still boots; route handlers enforce.
  // eslint-disable-next-line no-console
  console.warn("[db] DATABASE_URL is not set — database calls will fail.");
}

const sql = neon(connectionString ?? "postgres://invalid");

export const db = drizzle(sql, { schema });
export { schema };

export function assertDb(): void {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
}
