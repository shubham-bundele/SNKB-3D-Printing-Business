-- Migration: Track payment mode on orders for the ops remittance split
-- Prepaid (UPI/cards, collected at checkout) vs COD (cash collected on dispatch).

ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'Prepaid'
    CHECK (payment_mode IN ('Prepaid', 'COD'));
