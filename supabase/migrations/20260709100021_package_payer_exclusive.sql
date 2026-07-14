-- ============================================================================
-- IPD Migration 021: Payer-exclusive packages
-- Government-scheme / TPA rate lists (ABPMJAY HBP packages etc.) are often
-- offered only to that payer's patients. exclusive_payer_id restricts a
-- package to one account; NULL keeps it available to every payer (default).
-- ============================================================================

BEGIN;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS exclusive_payer_id uuid
  REFERENCES public.payers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_packages_exclusive_payer
  ON public.packages (clinic_id, exclusive_payer_id)
  WHERE exclusive_payer_id IS NOT NULL;

COMMIT;
