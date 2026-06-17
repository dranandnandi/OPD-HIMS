-- ABDM audit log table
-- Required for ABDM compliance — every API call must be traceable by REQUEST-ID

CREATE TABLE IF NOT EXISTS abdm_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  clinic_id UUID,
  action TEXT NOT NULL,          -- 'otp_request' | 'otp_verify' | 'profile_fetch'
  request_id UUID NOT NULL,      -- UUID sent as REQUEST-ID header to ABDM
  status TEXT NOT NULL,          -- 'success' | 'failure'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abdm_audit_log_patient ON abdm_audit_log (patient_id);
CREATE INDEX IF NOT EXISTS idx_abdm_audit_log_request ON abdm_audit_log (request_id);
CREATE INDEX IF NOT EXISTS idx_abdm_audit_log_created ON abdm_audit_log (created_at DESC);
