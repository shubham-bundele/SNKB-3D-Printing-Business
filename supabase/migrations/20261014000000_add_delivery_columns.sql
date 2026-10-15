-- Migration: Add Pan-India delivery columns to orders
-- Stores the checkout pincode, courier zone, delivery charge, and grand total
-- (print total + delivery) alongside the existing quoted_price print total.

ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS delivery_pincode TEXT,
  ADD COLUMN IF NOT EXISTS delivery_zone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS grand_total NUMERIC(10, 2);
