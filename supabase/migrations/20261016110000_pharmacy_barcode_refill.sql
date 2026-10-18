-- ============================================================================
-- Pharmacy: barcode per SKU, chronic flag, refill reminders.
--
--   * medicines_master.barcode   — the pack's EAN/GS1 code, scanned once when
--                                  the product is first seen; dispense and
--                                  purchase screens look items up by it.
--   * medicines_master.is_chronic — ticks the "refill reminder" box by default
--                                  when this medicine is sold.
--   * pharmacy_refill_reminders  — one row per sale that should trigger a
--                                  "time to refill" WhatsApp; the Netlify
--                                  scheduler (queue-auto-reminders) queues it
--                                  refillReminderLeadDays before due_date.
-- ============================================================================

BEGIN;

ALTER TABLE public.medicines_master
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS is_chronic boolean NOT NULL DEFAULT false;

-- Supplier invoices carry both a % and a flat rupee discount per line.
-- taxable_amount already reflects both; this keeps the flat figure for the record.
ALTER TABLE public.pharmacy_inward_items
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0;

-- One barcode maps to one SKU within a clinic. NULLs are free.
CREATE UNIQUE INDEX IF NOT EXISTS medicines_master_clinic_barcode_key
  ON public.medicines_master (clinic_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

COMMENT ON COLUMN public.medicines_master.barcode IS
  'Pack barcode (EAN-13 / GS1). Scanned once; dispense and inward screens match on it.';
COMMENT ON COLUMN public.medicines_master.is_chronic IS
  'Long-term medicine: the sale screen pre-ticks a refill reminder for it.';

CREATE TABLE IF NOT EXISTS public.pharmacy_refill_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  -- [{ "medicineId": uuid, "name": text, "quantity": int }]
  medicines jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'sent', 'cancelled')),
  note text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_refill_reminders_due
  ON public.pharmacy_refill_reminders (clinic_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_refill_reminders_patient
  ON public.pharmacy_refill_reminders (patient_id, due_date);

ALTER TABLE public.pharmacy_refill_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_refill_reminders;
DROP POLICY IF EXISTS tenant_write ON public.pharmacy_refill_reminders;
CREATE POLICY tenant_select ON public.pharmacy_refill_reminders FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY tenant_write ON public.pharmacy_refill_reminders FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- Default lead time for the scheduler: 3 days before the refill falls due.
UPDATE public.clinic_settings
   SET whatsapp_auto_send_config = whatsapp_auto_send_config || jsonb_build_object('refillReminderLeadDays', 3)
 WHERE whatsapp_auto_send_config IS NOT NULL
   AND NOT (whatsapp_auto_send_config ? 'refillReminderLeadDays');

COMMIT;
