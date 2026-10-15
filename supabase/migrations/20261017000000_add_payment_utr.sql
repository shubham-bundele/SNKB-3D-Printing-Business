-- Migration: Add payment_utr to public.orders table
-- Tracks the 12-digit UPI UTR / Transaction ID entered by the customer for payment verification.

ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS payment_utr TEXT;
