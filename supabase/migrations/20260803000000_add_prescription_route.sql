-- Add route (PO/IV/IM/etc.) to OPD prescriptions.
-- Nullable free-text so existing rows and custom routes remain valid.
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS route TEXT;
