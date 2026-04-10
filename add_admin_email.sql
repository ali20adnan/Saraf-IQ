-- إضافة حقل البريد للمسؤولين
ALTER TABLE IF EXISTS public.admins
ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_admins_email ON public.admins(email);
