/**
 * Railway PostgreSQL connection + schema bootstrap.
 * Full app data + local auth (users/sessions) live here. No Supabase.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type Pool as PgPool, type QueryResult, type QueryResultRow } from "pg";

let pool: PgPool | null = null;
let schemaReady: Promise<void> | null = null;

function databaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    ""
  ).trim();
}

export function hasPg(): boolean {
  return databaseUrl().length > 0;
}

export function getPgPool(): PgPool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    const needsSsl =
      /railway\.internal|rlwy\.net|railway\.app/i.test(url) ||
      process.env.PGSSLMODE === "require";
    pool = new Pool({
      connectionString: url,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", (err) => {
      console.error("PostgreSQL pool error:", err.message);
    });
  }
  return pool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPgPool();
  if (!p) throw new Error("DATABASE_URL is not set");
  return p.query<T>(text, params);
}

export async function pgOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const res = await pgQuery<T>(text, params);
  return res.rows[0] ?? null;
}

function loadSchemaSql(): string {
  const candidates = [
    path.join(process.cwd(), "db", "schema.sql"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf-8");
    }
  }
  throw new Error("db/schema.sql not found");
}

/** Apply schema once per process (idempotent CREATE IF NOT EXISTS). */
export async function ensurePgSchema(): Promise<boolean> {
  const p = getPgPool();
  if (!p) {
    console.warn("⚠️  DATABASE_URL not set — app data uses local JSON file");
    return false;
  }
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = loadSchemaSql();
      const client = await p.connect();
      try {
        await client.query(sql);
        console.log("✅ Railway PostgreSQL schema ready");
      } finally {
        client.release();
      }
    })().catch((err) => {
      schemaReady = null;
      console.error("❌ PostgreSQL schema init failed:", err);
      throw err;
    });
  }
  await schemaReady;
  return true;
}

export async function closePg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = null;
  }
}
