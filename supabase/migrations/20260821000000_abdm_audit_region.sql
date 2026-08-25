-- Record which region each ABDM call executed in.
--
-- Supabase runs Edge Functions in the region closest to the *caller*, not in
-- the project's region. So moving the project to Mumbai does not by itself
-- guarantee that ABDM calls are processed in India — a browser session outside
-- India would route the function elsewhere, taking patient identifiers and
-- ABDM tokens with it.
--
-- The frontend pins `x-region: ap-south-1`, but a header can be dropped and
-- inbound ABDM callbacks cannot set one at all. Recording the actual region
-- turns "our calls run in India" from an assertion into something provable
-- from the audit trail, and makes drift visible instead of silent.
--
-- Populated from the SB_REGION environment variable in the edge functions.

ALTER TABLE public.abdm_audit_log
  ADD COLUMN IF NOT EXISTS region TEXT;

-- Supports "show me anything that ran outside India" without a full scan.
CREATE INDEX IF NOT EXISTS idx_abdm_audit_log_region
  ON public.abdm_audit_log (region, created_at DESC)
  WHERE region IS DISTINCT FROM 'ap-south-1';
