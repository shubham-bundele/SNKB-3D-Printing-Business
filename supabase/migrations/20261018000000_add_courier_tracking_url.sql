-- Add optional courier tracking URL column to public.orders for Shipped notifications
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT;
