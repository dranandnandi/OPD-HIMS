/*
  # Add cleaned_medical_text column to ocr_results table

  1. Schema Changes
    - Add `cleaned_medical_text` column to `ocr_results` table
    - Column type: text (nullable)
    - Purpose: Store the output of first Gemini NLP stage (medical text extraction)

  2. Migration Details
    - Adds new column to store intermediate processing result
    - Allows for two-stage Gemini NLP processing:
      * Stage 1: Extract only medical data from raw OCR text
      * Stage 2: Structure the cleaned medical text into JSON format
    - Column is nullable to maintain backward compatibility
*/

-- Add cleaned_medical_text column to ocr_results table
ALTER TABLE ocr_results 
ADD COLUMN IF NOT EXISTS cleaned_medical_text text;

-- Add comment to document the column purpose
COMMENT ON COLUMN ocr_results.cleaned_medical_text IS 'Cleaned medical text extracted from raw OCR text by first Gemini NLP stage, removing clinic branding and non-medical information';