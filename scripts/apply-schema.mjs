import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

function readJson(path) {
  let t = fs.readFileSync(path, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return JSON.parse(t);
}

const pgVars = readJson("tmp-pg-vars.json");
const url = process.env.DATABASE_URL || pgVars.DATABASE_PUBLIC_URL || pgVars.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const sql = fs.readFileSync("db/schema.sql", "utf8");

try {
  await pool.query(sql);
  console.log("schema ok");
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`
  );
  console.log(r.rows.map((x) => x.table_name).join(", "));
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await pool.end();
}
