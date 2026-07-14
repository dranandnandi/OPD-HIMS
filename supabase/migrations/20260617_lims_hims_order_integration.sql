-- Clinic-level LIMS/HIMS lab order integration

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lab_test_integration_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS hims_lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  patient_id UUID REFERENCES patients(id),
  visit_id UUID REFERENCES visits(id),
  bill_id UUID REFERENCES bills(id),
  sample_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Order Created',
  referring_doctor TEXT,
  pdf_callback_url TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
  unmatched_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, external_order_id),
  UNIQUE (clinic_id, sample_id)
);

CREATE INDEX IF NOT EXISTS idx_hims_lab_orders_clinic_created_at
  ON hims_lab_orders(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hims_lab_orders_patient_id
  ON hims_lab_orders(patient_id);

ALTER TABLE hims_lab_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hims_lab_orders_clinic_isolation"
  ON hims_lab_orders
  FOR ALL
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_hims_lab_orders_updated_at ON hims_lab_orders;
CREATE TRIGGER update_hims_lab_orders_updated_at
  BEFORE UPDATE ON hims_lab_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
