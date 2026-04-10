-- السماح بمفاتيح محافظ مخصصة (wallet_*) بجانب الطرق الأربع الثابتة
-- نفّذه مرة واحدة على Supabase إن وُجدت قيد CHECK على method_key

ALTER TABLE public.agent_payment_methods
  DROP CONSTRAINT IF EXISTS agent_payment_methods_method_key_check;

ALTER TABLE public.agent_payment_methods
  ADD CONSTRAINT agent_payment_methods_method_key_check
  CHECK (
    method_key IN ('zaincash', 'superqi', 'firstbank', 'fastpay')
    OR method_key ~ '^wallet_[a-z0-9][a-z0-9_-]{0,20}$'
  );
