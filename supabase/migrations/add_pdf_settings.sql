-- Add PDF-related columns to clinic_settings table
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS pdf_header_url TEXT,
ADD COLUMN IF NOT EXISTS pdf_footer_url TEXT,
ADD COLUMN IF NOT EXISTS pdf_margins TEXT DEFAULT '180px 20px 150px 20px',
ADD COLUMN IF NOT EXISTS pdf_print_margins TEXT DEFAULT '180px 20px 150px 20px';

-- Add signature URL to profiles table  
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT;

-- Create storage bucket for PDF assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'pdf-assets', 
  'pdf-assets', 
  true, 
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for pdf-assets bucket
-- Allow authenticated users to upload to their clinic folder
CREATE POLICY "Users can upload clinic PDF assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pdf-assets' 
  AND (storage.foldername(name))[1] = 'clinic-pdf-assets'
);

-- Allow public read access to PDF assets
CREATE POLICY "Public read access to PDF assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'pdf-assets');

-- Allow users to update their clinic's assets
CREATE POLICY "Users can update clinic PDF assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'pdf-assets');

-- Allow users to delete their clinic's assets
CREATE POLICY "Users can delete clinic PDF assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'pdf-assets');
