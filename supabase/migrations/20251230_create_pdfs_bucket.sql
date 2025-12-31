-- Create a new public bucket 'pdfs' for storing generated reports and bills
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow authenticated users (doctors/staff) to upload files
CREATE POLICY "Allow authenticated users to upload pdfs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'pdfs');

-- Policy to allow public access to view PDFs (for WhatsApp links)
CREATE POLICY "Allow public to view pdfs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'pdfs');

-- Policy to allow authenticated users to update/delete (optional, for regeneration)
CREATE POLICY "Allow authenticated users to update pdfs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'pdfs');

CREATE POLICY "Allow authenticated users to delete pdfs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'pdfs');
