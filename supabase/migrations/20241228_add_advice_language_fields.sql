-- Add advice language fields to visits table for multi-language PDF support
-- These fields allow doctors to specify a regional language for patient advice

-- Add advice_language column (e.g., 'english', 'hindi', 'bengali', 'gujarati', etc.)
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS advice_language text DEFAULT 'english';

-- Add advice_regional column for storing advice in regional language
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS advice_regional text;

-- Add a comment to describe the purpose of these columns
COMMENT ON COLUMN public.visits.advice_language IS 'The language code for patient advice (e.g., english, hindi, bengali, gujarati, tamil, telugu, kannada, malayalam, marathi, punjabi, oriya)';
COMMENT ON COLUMN public.visits.advice_regional IS 'Patient advice text in the selected regional language for inclusion in PDF prescriptions';
