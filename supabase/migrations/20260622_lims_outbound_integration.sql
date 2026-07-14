-- LIMS Outbound Integration: Send test orders from OPD (HMS) to external LIMS

-- Add LIMS credentials to clinic_settings
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS lims_api_url TEXT,
  ADD COLUMN IF NOT EXISTS lims_api_key TEXT;

-- Table to track orders sent TO external LIMS
CREATE TABLE IF NOT EXISTS lims_outbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES visits(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  external_order_id TEXT, -- Order ID returned by LIMS
  lims_sample_id TEXT, -- Sample ID returned by LIMS
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, accepted, completed, failed
  tests_sent JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_tests JSONB DEFAULT '[]'::jsonb, -- Tests that LIMS matched
  unmatched_tests JSONB DEFAULT '[]'::jsonb, -- Tests that LIMS couldn't match
  lims_response JSONB, -- Full response from LIMS
  pdf_url TEXT, -- PDF report URL when completed
  pdf_received_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lims_outbound_orders_clinic_created
  ON lims_outbound_orders(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lims_outbound_orders_visit
  ON lims_outbound_orders(visit_id);

CREATE INDEX IF NOT EXISTS idx_lims_outbound_orders_status
  ON lims_outbound_orders(clinic_id, status);

ALTER TABLE lims_outbound_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lims_outbound_orders_clinic_isolation"
  ON lims_outbound_orders
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

DROP TRIGGER IF EXISTS update_lims_outbound_orders_updated_at ON lims_outbound_orders;
CREATE TRIGGER update_lims_outbound_orders_updated_at
  BEFORE UPDATE ON lims_outbound_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE lims_outbound_orders IS 'Tracks lab test orders sent from this OPD (HMS) to external LIMS systems';
COMMENT ON COLUMN lims_outbound_orders.external_order_id IS 'Order ID assigned by LIMS';
COMMENT ON COLUMN lims_outbound_orders.lims_sample_id IS 'Sample ID assigned by LIMS (e.g., LAB-22-Jun-2026-001)';
