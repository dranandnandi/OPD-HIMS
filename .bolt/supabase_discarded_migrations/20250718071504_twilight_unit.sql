/*
  # Create default roles for the system

  1. New Tables
    - Inserts default roles into the `roles` table
  
  2. Default Roles
    - `admin` - Full system access
    - `doctor` - Medical professional with patient management access
    - `nurse` - Limited patient management access
    - `receptionist` - Basic patient registration and appointment scheduling
  
  3. Security
    - No additional RLS policies needed as roles table policies already exist
*/

-- Insert default roles
INSERT INTO public.roles (role_name, description, permissions) VALUES
  ('admin', 'System Administrator', ARRAY['all']),
  ('doctor', 'Medical Doctor', ARRAY['patient_management', 'visit_management', 'prescription_management', 'billing_view', 'analytics_view']),
  ('nurse', 'Nurse', ARRAY['patient_registration', 'vitals_recording', 'follow_up_calls', 'appointment_scheduling']),
  ('receptionist', 'Receptionist', ARRAY['patient_registration', 'appointment_scheduling', 'billing_basic'])
ON CONFLICT (role_name) DO NOTHING;