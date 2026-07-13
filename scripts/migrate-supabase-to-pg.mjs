/**
 * One-time migration: copy app tables from Supabase → Railway PostgreSQL.
 * Auth users stay on Supabase. Profiles (balance/role) stay on Supabase.
 *
 * Usage (local, with public URLs):
 *   set SUPABASE_URL=...
 *   set SUPABASE_SERVICE_ROLE_KEY=...
 *   set DATABASE_URL=<Postgres DATABASE_PUBLIC_URL>
 *   node scripts/migrate-supabase-to-pg.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;

function env(name) {
  return (process.env[name] || "").trim();
}

const supabaseUrl = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const supabaseKey = env("SUPABASE_SERVICE_ROLE_KEY");
const databaseUrl = env("DATABASE_URL") || env("DATABASE_PUBLIC_URL");

if (!supabaseUrl || !supabaseKey) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("Need DATABASE_URL (use Railway Postgres public URL from local machine)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function fetchAll(table, orderCol = "created_at") {
  const { data, error } = await supabase.from(table).select("*").limit(10000);
  if (error) {
    console.warn(`skip ${table}:`, error.message);
    return [];
  }
  return data || [];
}

async function main() {
  const schema = fs.readFileSync("db/schema.sql", "utf8");
  await pool.query(schema);
  console.log("schema ready");

  // settings
  const settings = await fetchAll("settings");
  for (const row of settings) {
    if (!row?.key) continue;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [row.key, String(row.value ?? "")]
    );
  }
  console.log("settings:", settings.length);

  // site_profile
  const profiles = await fetchAll("site_profile");
  for (const row of profiles) {
    await pool.query(
      `INSERT INTO site_profile (id, full_name, email, phone, updated_at)
       VALUES (1, $1, $2, $3, COALESCE($4::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone`,
      [row.full_name ?? "", row.email ?? "", row.phone ?? "", row.updated_at ?? null]
    );
  }
  console.log("site_profile:", profiles.length);

  // offers
  const offers = await fetchAll("offers");
  for (const row of offers) {
    await pool.query(
      `INSERT INTO offers (id, variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),COALESCE($10::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.variant,
        row.title_ar ?? "",
        row.title_en ?? "",
        row.amount_display ?? "",
        row.unit_ar ?? "",
        row.unit_en ?? "",
        row.sort_order ?? 0,
        row.active,
        row.created_at,
      ]
    );
  }
  console.log("offers:", offers.length);

  // agents
  const agents = await fetchAll("agents");
  for (const row of agents) {
    await pool.query(
      `INSERT INTO agents (id, telegram_id, name, is_active, permissions, created_at)
       VALUES ($1,$2,$3,COALESCE($4,false),COALESCE($5,ARRAY[]::text[]),COALESCE($6::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET
         telegram_id = EXCLUDED.telegram_id,
         name = EXCLUDED.name,
         is_active = EXCLUDED.is_active,
         permissions = EXCLUDED.permissions`,
      [
        row.id,
        row.telegram_id,
        row.name ?? "",
        row.is_active,
        row.permissions ?? [],
        row.created_at,
      ]
    );
  }
  console.log("agents:", agents.length);

  // agent_numbers
  const numbers = await fetchAll("agent_numbers");
  for (const row of numbers) {
    await pool.query(
      `INSERT INTO agent_numbers (id, agent_id, phone_number, balance, is_exhausted, sort_order)
       VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,false),COALESCE($6,0))
       ON CONFLICT (id) DO UPDATE SET
         phone_number = EXCLUDED.phone_number,
         balance = EXCLUDED.balance,
         is_exhausted = EXCLUDED.is_exhausted,
         sort_order = EXCLUDED.sort_order`,
      [
        row.id,
        row.agent_id,
        row.phone_number ?? "",
        row.balance,
        row.is_exhausted,
        row.sort_order,
      ]
    );
  }
  console.log("agent_numbers:", numbers.length);

  // agent_payment_methods
  const methods = await fetchAll("agent_payment_methods");
  for (const row of methods) {
    await pool.query(
      `INSERT INTO agent_payment_methods
         (id, agent_id, method_key, account_number, account_holder, barcode_url, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()))
       ON CONFLICT (agent_id, method_key) DO UPDATE SET
         account_number = EXCLUDED.account_number,
         account_holder = EXCLUDED.account_holder,
         barcode_url = EXCLUDED.barcode_url,
         updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        row.agent_id,
        row.method_key,
        row.account_number,
        row.account_holder,
        row.barcode_url,
        row.updated_at,
      ]
    );
  }
  console.log("agent_payment_methods:", methods.length);

  // admins
  const admins = await fetchAll("admins");
  for (const row of admins) {
    await pool.query(
      `INSERT INTO admins (id, telegram_id, name, email, permissions, created_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,ARRAY[]::text[]),COALESCE($6::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         permissions = EXCLUDED.permissions`,
      [
        row.id,
        row.telegram_id,
        row.name,
        row.email ?? null,
        row.permissions ?? [],
        row.created_at,
      ]
    );
  }
  console.log("admins:", admins.length);

  // bot_users
  const botUsers = await fetchAll("bot_users");
  for (const row of botUsers) {
    await pool.query(
      `INSERT INTO bot_users (id, telegram_id, created_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, COALESCE($3::timestamptz, now()))
       ON CONFLICT (telegram_id) DO NOTHING`,
      [row.id ?? null, row.telegram_id, row.created_at]
    );
  }
  console.log("bot_users:", botUsers.length);

  // transactions
  const txs = await fetchAll("transactions");
  for (const row of txs) {
    await pool.query(
      `INSERT INTO transactions
         (id, order_ref, client_id, user_id, type, amount, method, status, details, agent_number_id, payment_proof, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'pending'),$9,$10,$11,COALESCE($12::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.order_ref,
        row.client_id ?? "",
        row.user_id ?? null,
        row.type,
        row.amount,
        row.method ?? "",
        row.status,
        row.details ?? null,
        row.agent_number_id ?? null,
        row.payment_proof ?? null,
        row.created_at,
      ]
    );
  }
  console.log("transactions:", txs.length);

  // push_tokens
  const tokens = await fetchAll("push_tokens");
  for (const row of tokens) {
    await pool.query(
      `INSERT INTO push_tokens (token, client_id, platform, updated_at)
       VALUES ($1,$2,COALESCE($3,'unknown'),COALESCE($4::timestamptz, now()))
       ON CONFLICT (token) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         platform = EXCLUDED.platform,
         updated_at = EXCLUDED.updated_at`,
      [row.token, row.client_id, row.platform, row.updated_at]
    );
  }
  console.log("push_tokens:", tokens.length);

  console.log("Migration complete.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
