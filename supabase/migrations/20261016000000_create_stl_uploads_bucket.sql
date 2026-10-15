-- Migration: Create stl-uploads bucket in Supabase Storage with policies
-- Allows secure storage of uploaded .stl and .3mf models up to 50MB (bypassing Vercel 4.5MB payload limit)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stl-uploads',
  'stl-uploads',
  false,
  52428800, -- 50 MB max file size (Supabase Free Tier cap)
  ARRAY['model/stl', 'model/3mf', 'application/octet-stream', 'model/stl-binary', 'model/stl-ascii']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

-- Storage policies for stl-uploads bucket
DO $$
BEGIN
  -- Service role full access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Service role full access on stl-uploads'
  ) THEN
    CREATE POLICY "Service role full access on stl-uploads"
      ON storage.objects
      FOR ALL
      TO service_role
      USING (bucket_id = 'stl-uploads')
      WITH CHECK (bucket_id = 'stl-uploads');
  END IF;

  -- Anon and authenticated users can insert (upload)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow public upload to stl-uploads'
  ) THEN
    CREATE POLICY "Allow public upload to stl-uploads"
      ON storage.objects
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (bucket_id = 'stl-uploads');
  END IF;

  -- Allow public read access via signed URLs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow read on stl-uploads'
  ) THEN
    CREATE POLICY "Allow read on stl-uploads"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated, service_role
      USING (bucket_id = 'stl-uploads');
  END IF;
END $$;
