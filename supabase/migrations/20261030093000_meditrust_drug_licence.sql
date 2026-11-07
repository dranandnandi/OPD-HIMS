-- User-supplied on 30 October 2026. Meditrust Clinics, Gujarat only.
-- Confirmed against the working 790-product catalogue and its existing licence.
-- The similarly named Meditrust Clinic Shela tenant is a separate test clinic.
-- Do not copy this licence into other tenants or treat it as NDPS authorization.
UPDATE public.clinic_settings SET drug_license_number='GJ-ADR-272601',updated_at=now()
WHERE id='238307be-362b-4fff-bb9a-3f2f9ff44519'::uuid
  AND lower(btrim(clinic_name))='meditrust clinics'
  AND drug_license_number IS DISTINCT FROM 'GJ-ADR-272601';
