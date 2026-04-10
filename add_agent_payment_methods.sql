-- طرق الاستلام لكل وكيل (سوبر كي/فاست بي/FIB/زين كاش)
-- نفّذ الملف مرة واحدة على Supabase

CREATE TABLE IF NOT EXISTS public.agent_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  method_key TEXT NOT NULL CHECK (method_key IN ('zaincash', 'superqi', 'firstbank', 'fastpay')),
  account_number TEXT NOT NULL,
  account_holder TEXT,
  barcode_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (agent_id, method_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_payment_methods_agent_id
  ON public.agent_payment_methods(agent_id);
