-- Supabase Database Schema

-- Users Table (extends Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Settings Table (for Admin controls)
CREATE TABLE IF NOT EXISTS public.settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert default settings
INSERT INTO public.settings (key, value) VALUES
  ('maintenance_mode', 'false'),
  ('buy_coming_soon', 'false'),
  ('sell_coming_soon', 'false')
ON CONFLICT (key) DO NOTHING;

-- Transactions Table
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id),
  type TEXT CHECK (type IN ('buy', 'sell')),
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read their own profile, Admins can read all
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Settings: Anyone can read settings, only Admins can update
CREATE POLICY "Anyone can view settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings" ON public.settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Transactions: Users can view own, Admins can view all
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON public.transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions" ON public.transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update transactions" ON public.transactions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Anonymous orders + Telegram order_ref (used by server API + service role)
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE public.transactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS order_ref TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS details TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_order_ref_uidx ON public.transactions (order_ref) WHERE order_ref IS NOT NULL;

-- Public offers (read via server with service role)
CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT NOT NULL CHECK (variant IN ('buy', 'sell')),
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  amount_display TEXT NOT NULL,
  unit_ar TEXT NOT NULL,
  unit_en TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.offers (variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order, active)
SELECT * FROM (VALUES
  ('sell'::text, 'بيع 100 ألف اسيا بـ 95 ألف', 'Sell 100k Asiacell for 95k IQD', '95,000', 'دينار', 'IQD', 1, true),
  ('buy', 'شراء 100 ألف اسيا بـ 98 ألف', 'Buy 100k Asiacell for 98k IQD', '100,000', 'اسيا سيل', 'Asiacell', 2, true),
  ('sell', 'بيع 50 ألف اسيا بـ 47.5 ألف دينار', 'Sell 50k Asiacell for 47.5k IQD', '47,500', 'دينار', 'IQD', 3, true),
  ('buy', 'شراء 25 ألف اسيا بـ 24.25 ألف', 'Buy 25k Asiacell for 24.25k IQD', '25,000', 'اسيا سيل', 'Asiacell', 4, true)
) AS v(variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order, active)
WHERE NOT EXISTS (SELECT 1 FROM public.offers LIMIT 1);

-- Site profile card (single row)
CREATE TABLE IF NOT EXISTS public.site_profile (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_name TEXT,
  email TEXT,
  phone TEXT,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.site_profile (id, full_name, email, phone) VALUES (1, 'Business User', 'user@example.com', '')
ON CONFLICT (id) DO NOTHING;
