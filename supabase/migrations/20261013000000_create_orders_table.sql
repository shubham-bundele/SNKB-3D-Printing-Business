-- Migration: Create orders table in Supabase Postgres
-- Bambu Lab A1 Mini 3D Printing Business Orders

CREATE TABLE IF NOT EXISTS public.orders (
  id             BIGSERIAL PRIMARY KEY,
  customer_name  TEXT NOT NULL DEFAULT 'Guest',
  customer_email TEXT,
  notes          TEXT,
  color          TEXT DEFAULT 'Concrete Grey',
  file_name      TEXT,
  file_path      TEXT,
  volume_mm3     DOUBLE PRECISION,
  weight_g       DOUBLE PRECISION,
  dimensions_xyz TEXT,
  quoted_price   NUMERIC(10, 2),
  status         TEXT NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending', 'Slicing', 'Printing', 'Completed', 'Shipped', 'Cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimize queries for admin sorting and status filtering
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);

-- Enable Row Level Security (RLS)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Allow public anonymous read access for order tracking by ID
CREATE POLICY "Allow public read access for tracking"
  ON public.orders
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anonymous quote submissions and updates (checkout confirmation)
CREATE POLICY "Allow public insert for quotes"
  ON public.orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update for checkout confirmation"
  ON public.orders
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
