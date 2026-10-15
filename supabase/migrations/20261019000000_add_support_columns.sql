-- Migration: Support material + slicer spec columns on orders
-- Stores per-quote Model vs Support split so /track and /admin can display
-- whether supports were requested.

ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS part_weight_g DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS support_weight_g DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supports_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS total_weight_g DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS material TEXT DEFAULT 'pla',
  ADD COLUMN IF NOT EXISTS layer_height_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dimensions_mm TEXT;
