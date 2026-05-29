-- Add balance to user profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS balance NUMERIC NOT NULL DEFAULT 0;

-- Allow deposit transactions
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
ADD CONSTRAINT transactions_type_check
CHECK (type IN ('buy', 'sell', 'deposit'));
