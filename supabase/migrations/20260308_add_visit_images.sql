-- Add visit_images JSONB column to visits table
-- Stores array of VisitImage objects: { id, url, imageType, label, aiAnalysis, uploadedAt }

ALTER TABLE visits
ADD COLUMN IF NOT EXISTS visit_images JSONB DEFAULT NULL;

-- Index for faster querying if needed
CREATE INDEX IF NOT EXISTS idx_visits_visit_images ON visits USING GIN (visit_images)
WHERE visit_images IS NOT NULL;
