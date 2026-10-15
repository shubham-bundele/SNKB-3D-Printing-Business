-- Migration 0003: Filament Spools Inventory
-- Tracks live spool stock in grams, materials, color presets, and availability.

CREATE TABLE IF NOT EXISTS public.filament_spools (
  id BIGSERIAL PRIMARY KEY,
  material TEXT NOT NULL,
  color_name TEXT NOT NULL UNIQUE,
  hex_code TEXT NOT NULL,
  remaining_grams DOUBLE PRECISION NOT NULL DEFAULT 1000.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rapid lookups by material and active status
CREATE INDEX IF NOT EXISTS idx_filament_spools_active ON public.filament_spools(is_active, material);

-- Seed initial stock matching catalog & preset colors
INSERT INTO public.filament_spools (material, color_name, hex_code, remaining_grams, is_active)
VALUES
  ('Tough PLA+', 'Concrete Grey', '#8E9296', 850.0, true),
  ('Tough PLA+', 'Carbon Black', '#22252a', 1250.0, true),
  ('Tough PLA+', 'Signal Orange', '#f97316', 420.0, true),
  ('Tough PLA+', 'Cyber Emerald', '#10b981', 310.0, true),
  ('Tough PLA+', 'Arctic White', '#f8fafc', 950.0, true),
  ('Tough PLA+', 'Translucent Cyan', '#06b6d4', 35.0, true),   -- Low spool restock flag sample
  ('Tough PLA+', 'Crimson Red', '#dc2626', 600.0, true),
  ('Tough PLA+', 'Cobalt Navy', '#2563eb', 550.0, true),
  ('Tough PLA+', 'Silk Gold', '#d97706', 480.0, true),
  ('Tough PLA+', 'Cyber Purple', '#9333ea', 220.0, true),
  ('Tough PLA+', 'Tactical Olive', '#4d7c0f', 340.0, true),
  ('Tough PLA+', 'Titanium Silver', '#94a3b8', 42.0, true),   -- Low spool restock flag sample
  ('Flexible TPU 95A', 'Stealth Black', '#1E2229', 400.0, true),
  ('Flexible TPU 95A', 'Safety Orange', '#FF5500', 160.0, true),
  ('Flexible TPU 95A', 'Neon Green', '#39FF14', 28.0, true)   -- Low spool restock flag sample
ON CONFLICT (color_name) DO UPDATE SET
  material = EXCLUDED.material,
  hex_code = EXCLUDED.hex_code,
  remaining_grams = EXCLUDED.remaining_grams,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
