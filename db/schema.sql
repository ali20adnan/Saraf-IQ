-- Saraf IQ — Railway PostgreSQL (full app + auth — no Supabase)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Auth users (replaces Supabase Auth + profiles)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure phone exists on older DBs
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_profile (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_name TEXT DEFAULT '',
  email TEXT DEFAULT 'user@example.com',
  phone TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO site_profile (id, full_name, email, phone)
VALUES (1, '', 'user@example.com', '')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id UUID,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'deposit')),
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  details TEXT,
  agent_number_id TEXT,
  payment_proof TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_order_ref_uidx
  ON transactions (order_ref);
CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions (client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at DESC);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT NOT NULL CHECK (variant IN ('buy', 'sell')),
  title_ar TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  amount_display TEXT NOT NULL DEFAULT '',
  unit_ar TEXT NOT NULL DEFAULT '',
  unit_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT false,
  permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_telegram ON agents (telegram_id);

CREATE TABLE IF NOT EXISTS agent_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL DEFAULT '',
  balance NUMERIC DEFAULT 0,
  is_exhausted BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_numbers_agent ON agent_numbers (agent_id);

CREATE TABLE IF NOT EXISTS agent_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  method_key TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT,
  barcode_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, method_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_payment_methods_agent
  ON agent_payment_methods (agent_id);

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  permissions TEXT[] DEFAULT ARRAY['manage_agents', 'site_settings', 'edit_links', 'view_stats']::TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admins_telegram ON admins (telegram_id);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins (email);

CREATE TABLE IF NOT EXISTS bot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_users_telegram ON bot_users (telegram_id);

CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_client ON push_tokens (client_id);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('maintenance_mode', 'false'),
  ('buy_coming_soon', 'false'),
  ('sell_coming_soon', 'false')
ON CONFLICT (key) DO NOTHING;

-- Default offers (only if empty)
INSERT INTO offers (variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order)
SELECT * FROM (VALUES
  ('sell'::text, 'بيع 100 ألف اسيا بـ 95 ألف', 'Sell 100k Asiacell for 95k IQD', '95,000', 'دينار', 'IQD', 1),
  ('buy', 'شراء 100 ألف اسيا بـ 98 ألف', 'Buy 100k Asiacell for 98k IQD', '100,000', 'اسيا سيل', 'Asiacell', 2),
  ('sell', 'بيع 50 ألف اسيا بـ 47.5 ألف دينار', 'Sell 50k Asiacell for 47.5k IQD', '47,500', 'دينار', 'IQD', 3),
  ('buy', 'شراء 25 ألف اسيا بـ 24.25 ألف', 'Buy 25k Asiacell for 24.25k IQD', '25,000', 'اسيا سيل', 'Asiacell', 4)
) AS v(variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM offers LIMIT 1);
