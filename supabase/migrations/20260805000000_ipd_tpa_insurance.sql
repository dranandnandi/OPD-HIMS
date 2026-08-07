-- IPD TPA / Insurance module: policy capture, pre-authorization, claim
-- lifecycle, deductions and settlement. Complements the existing payer/account
-- master (payers) and packages. All tenant-scoped by clinic_id.

-- 1. Per-admission insurance / policy details ---------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_insurance_details (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id),
  payer_id uuid REFERENCES public.payers(id),
  insurer_name text,
  tpa_name text,
  policy_number text,
  member_id text,
  sum_insured numeric DEFAULT 0,
  co_pay_percent numeric DEFAULT 0,
  room_rent_cap numeric,
  is_corporate boolean NOT NULL DEFAULT false,
  policy_valid_till date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipd_insurance_details_pkey PRIMARY KEY (id),
  CONSTRAINT ipd_insurance_details_admission_key UNIQUE (admission_id)
);

-- 2. Pre-authorizations (initial + enhancement) -------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_preauths (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id),
  preauth_type text NOT NULL DEFAULT 'initial'
    CHECK (preauth_type = ANY (ARRAY['initial','enhancement'])),
  requested_amount numeric NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status = ANY (ARRAY['requested','queried','approved','partial','rejected'])),
  approved_amount numeric,
  approval_ref text,
  approved_at timestamptz,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipd_preauths_pkey PRIMARY KEY (id)
);

-- 3. Claims -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id),
  bill_id uuid REFERENCES public.ipd_bills(id),
  claim_number text,
  claimed_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','submitted','queried','approved','settled','rejected'])),
  approved_amount numeric NOT NULL DEFAULT 0,
  received_amount numeric NOT NULL DEFAULT 0,
  deducted_amount numeric NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  settled_at timestamptz,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipd_claims_pkey PRIMARY KEY (id)
);

-- 4. Claim deductions / disallowances -----------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_claim_deductions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  claim_id uuid NOT NULL REFERENCES public.ipd_claims(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK (category = ANY (ARRAY['non_payable','consumable','excess','policy_exclusion','documentation','other'])),
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  borne_by text NOT NULL DEFAULT 'hospital'
    CHECK (borne_by = ANY (ARRAY['patient','hospital'])),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipd_claim_deductions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ipd_insurance_details_clinic_idx ON public.ipd_insurance_details (clinic_id);
CREATE INDEX IF NOT EXISTS ipd_preauths_admission_idx ON public.ipd_preauths (admission_id);
CREATE INDEX IF NOT EXISTS ipd_claims_admission_idx ON public.ipd_claims (admission_id);
CREATE INDEX IF NOT EXISTS ipd_claims_clinic_status_idx ON public.ipd_claims (clinic_id, status);
CREATE INDEX IF NOT EXISTS ipd_claim_deductions_claim_idx ON public.ipd_claim_deductions (claim_id);

-- RLS: tenant-scoped like the rest of the IPD suite --------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_insurance_details','ipd_preauths','ipd_claims','ipd_claim_deductions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY "tenant all %1$s" ON public.%1$I FOR ALL TO authenticated
      USING (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()));
    $p$, t);
  END LOOP;
END $$;
