-- ============================================================
-- FIX Migration: Update WhatsApp Templates Placeholders
-- ============================================================
-- This fixes the placeholder naming from snake_case to camelCase
-- and removes the duplicate message_queue table
-- Run this AFTER the original migration was already applied
-- ============================================================

-- ============================================
-- 1. Update Default WhatsApp Templates (for clinics that haven't customized yet)
-- ============================================
-- Update the column default for new clinics
ALTER TABLE public.clinic_settings 
ALTER COLUMN whatsapp_templates 
SET DEFAULT '{
  "appointment_confirmation": "Dear {{patientName}}, your appointment with Dr. {{doctorName}} is confirmed for {{appointmentDate}}. Please arrive 10 minutes early. - {{clinicName}}",
  "appointment_reminder": "Reminder: You have an appointment tomorrow at {{appointmentDate}} with Dr. {{doctorName}}. Please confirm your attendance. - {{clinicName}}",
  "visit_prescription": "Dear {{patientName}}, your prescription is ready. Download here: {{pdfUrl}} - {{clinicName}}",
  "invoice_generated": "Dear {{patientName}}, your invoice #{{billNumber}} for {{totalAmount}} is ready. Download: {{pdfUrl}} - {{clinicName}}",
  "thank_you": "Thank you for visiting {{clinicName}} today! We hope you feel better soon. Please leave us a review: {{reviewLink}}"
}'::jsonb;

-- ============================================
-- 2. Update Existing Clinic Templates (fix snake_case to camelCase)
-- ============================================
-- This updates clinics that still have the old snake_case placeholders
UPDATE public.clinic_settings
SET whatsapp_templates = jsonb_build_object(
  'appointment_confirmation', 
  replace(replace(replace(replace(replace(
    COALESCE(whatsapp_templates->>'appointment_confirmation', ''),
    '{{patient_name}}', '{{patientName}}'),
    '{{doctor_name}}', '{{doctorName}}'),
    '{{clinic_name}}', '{{clinicName}}'),
    '{{date}}', '{{appointmentDate}}'),
    '{{time}}', '{{appointmentDate}}'
  ),
  'appointment_reminder',
  replace(replace(replace(replace(replace(
    COALESCE(whatsapp_templates->>'appointment_reminder', ''),
    '{{patient_name}}', '{{patientName}}'),
    '{{doctor_name}}', '{{doctorName}}'),
    '{{clinic_name}}', '{{clinicName}}'),
    '{{date}}', '{{appointmentDate}}'),
    '{{time}}', '{{appointmentDate}}'
  ),
  'visit_prescription',
  replace(replace(replace(
    COALESCE(whatsapp_templates->>'visit_prescription', ''),
    '{{patient_name}}', '{{patientName}}'),
    '{{clinic_name}}', '{{clinicName}}'),
    '{{pdf_url}}', '{{pdfUrl}}'
  ),
  'invoice_generated',
  replace(replace(replace(replace(replace(
    COALESCE(whatsapp_templates->>'invoice_generated', ''),
    '{{patient_name}}', '{{patientName}}'),
    '{{clinic_name}}', '{{clinicName}}'),
    '{{pdf_url}}', '{{pdfUrl}}'),
    '{{bill_number}}', '{{billNumber}}'),
    '{{amount}}', '{{totalAmount}}'
  ),
  'thank_you',
  replace(replace(
    COALESCE(whatsapp_templates->>'thank_you', ''),
    '{{clinic_name}}', '{{clinicName}}'),
    '{{review_link}}', '{{reviewLink}}'
  )
)
WHERE whatsapp_templates IS NOT NULL 
  AND (
    whatsapp_templates::text LIKE '%{{patient_name}}%' 
    OR whatsapp_templates::text LIKE '%{{doctor_name}}%'
    OR whatsapp_templates::text LIKE '%{{clinic_name}}%'
  );

-- ============================================
-- 3. Drop message_queue table if it exists (we use whatsapp_message_queue instead)
-- ============================================
DROP TABLE IF EXISTS public.message_queue CASCADE;

-- ============================================
-- 4. Drop the helper functions for the removed table
-- ============================================
DROP FUNCTION IF EXISTS public.get_pending_messages(integer);
DROP FUNCTION IF EXISTS public.update_message_status(uuid, text, text);

-- Verify the fix
SELECT 
  id,
  clinic_name,
  whatsapp_templates->>'appointment_confirmation' as sample_template
FROM public.clinic_settings
LIMIT 3;
