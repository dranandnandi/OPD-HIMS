-- Full-page letterhead mode for prescription / invoice PDFs.
--
-- Two mutually exclusive ways to brand a generated PDF:
--   'bands' (default, existing behaviour) — separate header + footer images are
--            inlined into PDF.co's header/footer templates and the API reserves
--            margins for them.
--   'full'  — one A4 letterhead image is painted as a fixed, full-bleed
--            background on every page; API margins go to zero and the content is
--            kept clear of the artwork by thead/tfoot spacer rows.
--
-- Defaulting to 'bands' keeps every existing clinic on exactly the output they
-- have today; the new mode is opt-in from Settings → PDF Settings.
ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS pdf_letterhead_mode TEXT NOT NULL DEFAULT 'bands',
ADD COLUMN IF NOT EXISTS pdf_letterhead_url TEXT,
ADD COLUMN IF NOT EXISTS pdf_letterhead_spacing JSONB
  DEFAULT '{"top": 130, "bottom": 130, "left": 20, "right": 20}'::jsonb;

DO $$
BEGIN
  ALTER TABLE clinic_settings
    ADD CONSTRAINT clinic_settings_pdf_letterhead_mode_check
    CHECK (pdf_letterhead_mode IN ('bands', 'full'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN clinic_settings.pdf_letterhead_mode IS
  'bands = separate header/footer images (default); full = single full-page letterhead background';
COMMENT ON COLUMN clinic_settings.pdf_letterhead_url IS
  'Public URL of the full-page A4 letterhead image used when pdf_letterhead_mode = full';
COMMENT ON COLUMN clinic_settings.pdf_letterhead_spacing IS
  'Content inset in px for full letterhead mode: {top, bottom} become repeating page spacers, {left, right} become CSS padding';

-- The full letterhead is fetched by PDF.co over the network (not inlined), so it
-- can be a much larger file than the 5MB band images the bucket was created for.
UPDATE storage.buckets
SET file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 10485760)
WHERE id = 'pdf-assets';
