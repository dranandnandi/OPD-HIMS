-- ============================================================
-- Complete Templates, Presets & PDF Storage Migration
-- ============================================================
-- This migration adds:
-- 1. PDF Header/Footer URLs to clinic_settings
-- 2. WhatsApp message templates to clinic_settings
-- 3. Prescription Presets table
-- 4. PDF URL tracking fields to visits and bills
-- NOTE: Uses existing whatsapp_message_queue table (not creating new)
-- ============================================================

-- ============================================
-- 1. Add PDF Header/Footer to clinic_settings
-- ============================================
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS pdf_header_url text,
ADD COLUMN IF NOT EXISTS pdf_footer_url text;

COMMENT ON COLUMN public.clinic_settings.pdf_header_url IS 'URL of header image for PDF generation';
COMMENT ON COLUMN public.clinic_settings.pdf_footer_url IS 'URL of footer image for PDF generation';

-- ============================================
-- 2. Add WhatsApp Templates to clinic_settings
-- ============================================
-- NOTE: Placeholders use camelCase to match whatsappAutoSendService.ts
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS whatsapp_templates jsonb DEFAULT '{
  "appointment_confirmation": "Dear {{patientName}}, your appointment with Dr. {{doctorName}} is confirmed for {{appointmentDate}}. Please arrive 10 minutes early. - {{clinicName}}",
  "appointment_reminder": "Reminder: You have an appointment tomorrow at {{appointmentDate}} with Dr. {{doctorName}}. Please confirm your attendance. - {{clinicName}}",
  "visit_prescription": "Dear {{patientName}}, your prescription is ready. Download here: {{pdfUrl}} - {{clinicName}}",
  "invoice_generated": "Dear {{patientName}}, your invoice #{{billNumber}} for {{totalAmount}} is ready. Download: {{pdfUrl}} - {{clinicName}}",
  "thank_you": "Thank you for visiting {{clinicName}} today! We hope you feel better soon. Please leave us a review: {{reviewLink}}"
}'::jsonb;

COMMENT ON COLUMN public.clinic_settings.whatsapp_templates IS 'Customizable WhatsApp message templates with placeholders';

-- ============================================
-- 3. Create Prescription Presets Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.prescription_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  -- Preset identification
  name text NOT NULL,
  description text,
  
  -- Condition/category for organizing
  condition text,
  tags text[] DEFAULT '{}',
  
  -- Prescription data (JSON structure)
  -- { medicines: [...], advice: [...], followUpDays: number }
  preset_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Metadata
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  
  CONSTRAINT prescription_presets_pkey PRIMARY KEY (id),
  CONSTRAINT prescription_presets_unique_name UNIQUE (clinic_id, name)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_prescription_presets_clinic 
ON public.prescription_presets(clinic_id, is_active);

CREATE INDEX IF NOT EXISTS idx_prescription_presets_tags 
ON public.prescription_presets USING GIN(tags);

-- Enable RLS
ALTER TABLE public.prescription_presets ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their clinic's presets
DROP POLICY IF EXISTS "Users can view their clinic presets" ON public.prescription_presets;
CREATE POLICY "Users can view their clinic presets" 
ON public.prescription_presets FOR SELECT 
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can manage their clinic presets" ON public.prescription_presets;
CREATE POLICY "Users can manage their clinic presets" 
ON public.prescription_presets FOR ALL 
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- ============================================
-- 4. Add PDF URL tracking to visits and bills
-- ============================================
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS pdf_url text,
ADD COLUMN IF NOT EXISTS pdf_generated_at timestamp with time zone;

ALTER TABLE public.bills 
ADD COLUMN IF NOT EXISTS pdf_url text,
ADD COLUMN IF NOT EXISTS pdf_generated_at timestamp with time zone;

COMMENT ON COLUMN public.visits.pdf_url IS 'Permanent URL of the generated visit/prescription PDF';
COMMENT ON COLUMN public.bills.pdf_url IS 'Permanent URL of the generated bill/invoice PDF';

-- ============================================
-- 5. Function to Seed Default Presets
-- ============================================
CREATE OR REPLACE FUNCTION public.seed_default_presets(p_clinic_id uuid)
RETURNS void AS $$
BEGIN
  -- Only insert if clinic has no presets
  IF NOT EXISTS (SELECT 1 FROM public.prescription_presets WHERE clinic_id = p_clinic_id) THEN
    
    -- Common Cold / URTI
    INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
    VALUES (
      p_clinic_id,
      'Common Cold / URTI',
      'Standard treatment for upper respiratory tract infection',
      'Respiratory',
      ARRAY['cold', 'fever', 'cough', 'viral'],
      '{
        "medicines": [
          {"medicine": "Paracetamol", "dosage": "500mg", "frequency": "TDS", "duration": "3 days", "instructions": "after food"},
          {"medicine": "Cetirizine", "dosage": "10mg", "frequency": "OD", "duration": "5 days", "instructions": "at night"},
          {"medicine": "Ambroxol", "dosage": "30mg", "frequency": "BD", "duration": "5 days", "instructions": "after food"}
        ],
        "advice": ["Drink plenty of warm fluids", "Rest adequately", "Steam inhalation twice daily", "Avoid cold drinks and ice cream"],
        "followUpDays": 3
      }'::jsonb
    );

    -- Gastritis / Acidity
    INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
    VALUES (
      p_clinic_id,
      'Gastritis / Acidity',
      'Treatment for acid reflux and gastritis',
      'Gastrointestinal',
      ARRAY['acidity', 'gastritis', 'reflux', 'stomach'],
      '{
        "medicines": [
          {"medicine": "Pantoprazole", "dosage": "40mg", "frequency": "OD", "duration": "14 days", "instructions": "before breakfast"},
          {"medicine": "Domperidone", "dosage": "10mg", "frequency": "TDS", "duration": "7 days", "instructions": "before meals"}
        ],
        "advice": ["Avoid spicy and oily food", "Eat small frequent meals", "Avoid lying down immediately after meals", "No smoking or alcohol"],
        "followUpDays": 14
      }'::jsonb
    );

    -- Fever (Viral)
    INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
    VALUES (
      p_clinic_id,
      'Viral Fever',
      'Symptomatic treatment for viral fever',
      'Infectious',
      ARRAY['fever', 'viral', 'body ache'],
      '{
        "medicines": [
          {"medicine": "Paracetamol", "dosage": "650mg", "frequency": "TDS", "duration": "3 days", "instructions": "after food, if fever >100°F"},
          {"medicine": "Zinc + Vitamin C", "dosage": "", "frequency": "OD", "duration": "7 days", "instructions": "after food"}
        ],
        "advice": ["Complete bed rest", "Drink plenty of fluids", "Tepid sponging if fever is high", "Monitor temperature regularly"],
        "followUpDays": 3
      }'::jsonb
    );

    -- Allergic Rhinitis
    INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
    VALUES (
      p_clinic_id,
      'Allergic Rhinitis',
      'Treatment for nasal allergy',
      'Allergy',
      ARRAY['allergy', 'sneezing', 'rhinitis', 'hay fever'],
      '{
        "medicines": [
          {"medicine": "Levocetirizine", "dosage": "5mg", "frequency": "OD", "duration": "7 days", "instructions": "at night"},
          {"medicine": "Fluticasone Nasal Spray", "dosage": "2 sprays each nostril", "frequency": "BD", "duration": "14 days", "instructions": ""},
          {"medicine": "Montelukast", "dosage": "10mg", "frequency": "OD", "duration": "14 days", "instructions": "at night"}
        ],
        "advice": ["Avoid known allergens (dust, pollen)", "Use air purifier if possible", "Keep windows closed during high pollen times", "Wash hands and face after coming from outside"],
        "followUpDays": 14
      }'::jsonb
    );

    -- Body Pain / Musculoskeletal
    INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
    VALUES (
      p_clinic_id,
      'Body Pain / Muscle Strain',
      'Treatment for musculoskeletal pain',
      'Musculoskeletal',
      ARRAY['pain', 'body ache', 'muscle', 'strain'],
      '{
        "medicines": [
          {"medicine": "Aceclofenac + Paracetamol", "dosage": "100mg+325mg", "frequency": "BD", "duration": "5 days", "instructions": "after food"},
          {"medicine": "Thiocolchicoside", "dosage": "4mg", "frequency": "BD", "duration": "5 days", "instructions": "after food"}
        ],
        "advice": ["Apply hot fomentation locally", "Rest the affected area", "Avoid lifting heavy weights", "Sleep on a firm mattress"],
        "followUpDays": 5
      }'::jsonb
    );

  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. Trigger to update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_prescription_presets_updated_at ON public.prescription_presets;
CREATE TRIGGER update_prescription_presets_updated_at
  BEFORE UPDATE ON public.prescription_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
