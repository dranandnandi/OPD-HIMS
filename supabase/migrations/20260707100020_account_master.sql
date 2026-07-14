-- ============================================================================
-- IPD Migration 020: Account master + payer price lists (LIMS accounts pattern)
--
-- payers becomes a full ACCOUNT master (insurers, TPAs, government schemes,
-- corporate tie-ups): billing contacts, GST, credit limit/used, default
-- discount, billing mode — mirroring LIMS `accounts`.
--
-- Price-list tagging (LIMS account_prices / account_package_prices):
--   * services  → tariff_rates rows under the payer's default tariff plan
--                 (get_default_payer_plan auto-creates "Rates — <payer>")
--   * packages  → payer_package_prices (optionally bed-class-specific)
-- Resolution for an admission's package price:
--   payer+package+class → payer+package → class price → package base.
-- ============================================================================

BEGIN;

-- 1. Account fields on payers (LIMS accounts parity)
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS billing_phone text;
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS gst_number text;
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS default_discount_percent numeric(5,2) NOT NULL DEFAULT 0
  CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100);
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2) NOT NULL DEFAULT 0
  CHECK (credit_limit >= 0);
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS credit_used numeric(14,2) NOT NULL DEFAULT 0
  CHECK (credit_used >= 0);
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'standard'
  CHECK (billing_mode IN ('standard', 'monthly'));

-- 2. Payer-wise package prices (class-specific when bed_type_id set)
CREATE TABLE IF NOT EXISTS public.payer_package_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  bed_type_id uuid REFERENCES public.bed_types(id) ON DELETE CASCADE, -- NULL = all classes
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_package_class_price
  ON public.payer_package_prices (payer_id, package_id,
      COALESCE(bed_type_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.payer_package_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON public.payer_package_prices FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY tenant_write ON public.payer_package_prices FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- 3. Default tariff plan per payer (service price list lives here)
CREATE OR REPLACE FUNCTION public.get_default_payer_plan(
  p_clinic_id uuid, p_payer_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan uuid;
  v_name text;
BEGIN
  SELECT id INTO v_plan FROM public.tariff_plans
   WHERE clinic_id = p_clinic_id AND payer_id = p_payer_id AND is_active = true
   ORDER BY created_at LIMIT 1;
  IF v_plan IS NOT NULL THEN RETURN v_plan; END IF;

  SELECT name INTO v_name FROM public.payers WHERE id = p_payer_id;
  INSERT INTO public.tariff_plans (clinic_id, name, payer_id)
  VALUES (p_clinic_id, 'Rates — ' || COALESCE(v_name, 'Account'), p_payer_id)
  RETURNING id INTO v_plan;
  RETURN v_plan;
END;
$$;

COMMIT;
