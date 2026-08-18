-- Optional branding on the print / compact-print PDFs.
--
-- Those two variants were built for clinics that print onto pre-printed
-- letterhead stationery, so they deliberately render no header, no footer and no
-- letterhead — the paper already carries it. Clinics printing on plain paper
-- want the opposite. This flag lets them opt in; whichever branding style is
-- configured (header/footer bands or full-page letterhead) is then rendered on
-- the print copies too, in black and white to match the rest of that output.
--
-- Defaults to false so existing clinics keep the blank-band print copies they
-- have today.
ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS pdf_print_branding BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN clinic_settings.pdf_print_branding IS
  'When true, print and compact-print PDFs also carry the configured branding, rendered in black and white';
