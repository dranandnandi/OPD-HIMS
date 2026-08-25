-- Visit attachments: allow videos and PDFs alongside clinical images.
--
-- Visit attachments are stored in the `ocruploads` bucket under `visit_images/`
-- and referenced from the `visits.visit_images` JSONB column. The column itself
-- needs no change (the new `mimeType` / `fileSize` keys and the `video` /
-- `document` categories are just extra JSON fields), but the bucket must accept
-- the larger, non-image objects.

-- Ensure the bucket exists and is public (URLs are embedded directly in the EMR).
INSERT INTO storage.buckets (id, name, public)
VALUES ('ocruploads', 'ocruploads', true)
ON CONFLICT (id) DO NOTHING;

-- Raise the object size ceiling to 100 MB (the app caps videos at 100 MB,
-- images at 15 MB and PDFs at 25 MB before upload) and allow the media types
-- the attachment picker accepts. NULL allowed_mime_types means "any type", so
-- only narrow it when it is already restricted.
UPDATE storage.buckets
SET
  file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 104857600),
  allowed_mime_types = CASE
    WHEN allowed_mime_types IS NULL THEN NULL
    ELSE ARRAY(
      SELECT DISTINCT unnest(
        allowed_mime_types || ARRAY[
          'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
          'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp',
          'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
          'application/pdf'
        ]
      )
    )
  END
WHERE id = 'ocruploads';
