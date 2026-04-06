-- جدول تسجيل رموز FCM (اختياري — إن كنت تستخدم Supabase للخادم)
-- نفّذه مرة واحدة إن أردت تخزين الرموز في قاعدة البيانات بدل الملف فقط

CREATE TABLE IF NOT EXISTS public.push_tokens (
  token TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_client ON public.push_tokens(client_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role push_tokens" ON public.push_tokens FOR ALL USING (true) WITH CHECK (true);
