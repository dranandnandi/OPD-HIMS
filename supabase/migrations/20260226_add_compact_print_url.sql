-- Add compact_print_pdf_url column to visits table for caching compact prescriptions
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS compact_print_pdf_url TEXT;
