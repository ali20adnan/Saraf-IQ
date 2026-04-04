-- ============================================
-- FIX: إصلاح مشاكل الـ Schema وإضافة الجداول الناقصة
-- ============================================

-- 1. حذف الجدول settings القديم وإعادة إنشائه بشكل صحيح
DROP TABLE IF EXISTS public.settings CASCADE;

-- 2. إنشاء جدول settings الصحيح (key as primary key)
CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 3. إضافة الإعدادات الافتراضية
INSERT INTO public.settings (key, value) VALUES
  ('maintenance_mode', 'false'),
  ('buy_coming_soon', 'false'),
  ('sell_coming_soon', 'false')
ON CONFLICT (key) DO NOTHING;

-- 4. إنشاء جدول site_profile (ناقص)
CREATE TABLE IF NOT EXISTS public.site_profile (
  id INTEGER PRIMARY KEY DEFAULT 1,
  full_name TEXT DEFAULT '',
  email TEXT DEFAULT 'user@example.com',
  phone TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إدخال صف افتراضي
INSERT INTO public.site_profile (id, full_name, email, phone) 
VALUES (1, '', 'user@example.com', '')
ON CONFLICT (id) DO NOTHING;

-- 5. إنشاء جدول admins (ناقص)
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['manage_agents', 'site_settings', 'view_stats'],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء الجداول الأخرى المفقودة
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT false,
  permissions TEXT[] DEFAULT ARRAY['add_number', 'reset_balance'],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  phone_number TEXT,
  balance NUMERIC DEFAULT 0,
  is_exhausted BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT CHECK (variant IN ('buy', 'sell')),
  title_ar TEXT,
  title_en TEXT,
  amount_display TEXT,
  unit_ar TEXT,
  unit_en TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bot_users (
  telegram_id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. تعديل جدول transactions ليتوافق مع الكود
-- ملاحظة: إذا كان الجدول موجودًا ومستخدمًا، احذفه وأعد إنشاءه
-- إذا لم تكن قد استخدمته بعد:
DROP TABLE IF EXISTS public.transactions CASCADE;

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  type TEXT CHECK (type IN ('buy', 'sell')),
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  details TEXT,
  agent_number_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- RLS Policies (Row Level Security)
-- ============================================

-- تشغيل RLS على الجداول
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- السماح بالوصول الكامل للـ Service Role Key (للـ Server)
CREATE POLICY "Service role bypass" ON public.settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass site" ON public.site_profile FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass admins" ON public.admins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass agents" ON public.agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass numbers" ON public.agent_numbers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass offers" ON public.offers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass bot" ON public.bot_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass tx" ON public.transactions FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- الفهارس Indexes (للأداء)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_agents_telegram ON public.agents(telegram_id);
CREATE INDEX IF NOT EXISTS idx_admins_telegram ON public.admins(telegram_id);
CREATE INDEX IF NOT EXISTS idx_agent_numbers_agent ON public.agent_numbers(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_client ON public.transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_order_ref ON public.transactions(order_ref);
CREATE INDEX IF NOT EXISTS idx_bot_users_telegram ON public.bot_users(telegram_id);

-- ============================================
-- العروض الافتراضية (Default Offers)
-- استخدم UUID حقيقية بدلاً من 'seed-1'
INSERT INTO public.offers (variant, title_ar, title_en, amount_display, unit_ar, unit_en, sort_order) VALUES
  ('sell', 'بيع 100 ألف اسيا بـ 95 ألف', 'Sell 100k Asiacell for 95k IQD', '95,000', 'دينار', 'IQD', 1),
  ('buy', 'شراء 100 ألف اسيا بـ 98 ألف', 'Buy 100k Asiacell for 98k IQD', '100,000', 'اسيا سيل', 'Asiacell', 2),
  ('sell', 'بيع 50 ألف اسيا بـ 47.5 ألف دينار', 'Sell 50k Asiacell for 47.5k IQD', '47,500', 'دينار', 'IQD', 3),
  ('buy', 'شراء 25 ألف اسيا بـ 24.25 ألف', 'Buy 25k Asiacell for 24.25k IQD', '25,000', 'اسيا سيل', 'Asiacell', 4)
ON CONFLICT DO NOTHING;
