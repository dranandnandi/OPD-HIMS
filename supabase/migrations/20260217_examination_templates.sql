-- ============================================================
-- Examination Templates Migration
-- ============================================================
-- Clinic-level reusable examination templates for
-- general examination + local examination fields.
-- Follows prescription_presets pattern.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.examination_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,

  -- Template identification
  name text NOT NULL,
  description text,
  specialization text,

  -- Template content (JSON structure matching PhysicalExamination.sections)
  template_data jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,

  -- Metadata
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT examination_templates_pkey PRIMARY KEY (id),
  CONSTRAINT examination_templates_unique_name UNIQUE (clinic_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_examination_templates_clinic
ON public.examination_templates(clinic_id, is_active);

CREATE INDEX IF NOT EXISTS idx_examination_templates_specialization
ON public.examination_templates(clinic_id, specialization);

-- Enable RLS
ALTER TABLE public.examination_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their clinic examination templates" ON public.examination_templates;
CREATE POLICY "Users can view their clinic examination templates"
ON public.examination_templates FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can manage their clinic examination templates" ON public.examination_templates;
CREATE POLICY "Users can manage their clinic examination templates"
ON public.examination_templates FOR ALL
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Auto-update trigger (reuses existing function)
DROP TRIGGER IF EXISTS update_examination_templates_updated_at ON public.examination_templates;
CREATE TRIGGER update_examination_templates_updated_at
  BEFORE UPDATE ON public.examination_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
