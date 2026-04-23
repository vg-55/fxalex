import { neon } from "@neondatabase/serverless";
import fs from "fs";
const env = fs.readFileSync("/Users/vaibhavg/code/fxaleg/fx-signals-app/.env.local", "utf8");
for (const line of env.split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const [k, ...v] = line.split("=");
  process.env[k.trim()] = v.join("=").trim();
}
const sql = neon(process.env.DATABASE_URL);
try {
  const r = await sql`SELECT 1 as ok`;
  console.log("OK", r);
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
  console.log("TABLES", tables);
} catch (e) {
  console.error("ERR", e.message, e.cause?.message);
}
