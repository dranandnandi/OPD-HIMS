-- Add invoice PDF settings columns to clinic_settings table
-- This enables separate paper size (A4/A5) and margins for invoices

ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS invoice_paper_size text DEFAULT 'A4' CHECK (invoice_paper_size IN ('A4', 'A5'));

ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS invoice_margins text DEFAULT '180px 20px 150px 20px';

-- Add print PDF URL column to bills table for caching print version
ALTER TABLE bills
ADD COLUMN IF NOT EXISTS print_pdf_url text;

COMMENT ON COLUMN clinic_settings.invoice_paper_size IS 'Paper size for invoice PDFs: A4 (default) or A5';
COMMENT ON COLUMN clinic_settings.invoice_margins IS 'CSS margins for invoice PDFs (top right bottom left)';
COMMENT ON COLUMN bills.print_pdf_url IS 'Cached URL for print version PDF (no header/footer for letterhead)';
