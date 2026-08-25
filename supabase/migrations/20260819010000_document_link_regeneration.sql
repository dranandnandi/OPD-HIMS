-- Make stable links usable for the "open immediately, generate in background"
-- flow, which is the whole point of publishing a temp URL early.
--
-- Two things were missing.
--
-- 1. The resolver decided "is a generation still in flight?" from created_at.
--    That is only correct the first time. Regenerating a two-week-old document
--    left created_at two weeks in the past, so the resolver skipped the
--    "preparing" page and showed an error instead of waiting for the new copy.
--
-- 2. A forced regeneration kept its previous permanent_url, and hook (b) is
--    guarded with `.is('permanent_url', null)` so it would not publish the new
--    temp URL over it. Opening the link during that window served the OLD PDF —
--    exactly wrong when the user pressed regenerate to pick up fresh content.

-- When the current generation run started. NULL for links that predate this.
ALTER TABLE public.document_links
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;

COMMENT ON COLUMN public.document_links.generation_started_at IS
  'Start of the most recent generation run. The resolver ages its "preparing" window from this, falling back to created_at.';

-- ---------------------------------------------------------------------------
-- Mint-or-restart.
--
-- ensure_document_link() stays a pure mint (never disturbs a live link, safe to
-- call on every open). This one additionally retires the current copy, so the
-- resolver shows "preparing" and then picks up the newly published temp URL
-- rather than serving the previous PDF.
--
-- Call this — not ensure_document_link — when regenerating.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_document_link_generation(
  p_entity_type text,
  p_entity_id   uuid,
  p_variant     text DEFAULT 'display'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  -- Reuses the tenant guard, validation and race handling in ensure_document_link.
  v_token := public.ensure_document_link(p_entity_type, p_entity_id, p_variant);
  IF v_token IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE document_links
     SET status                = 'pending',
         permanent_url         = NULL,
         temp_url              = NULL,
         temp_expires_at       = NULL,
         generation_started_at = now()
   WHERE token = v_token;

  RETURN v_token;
END $$;

REVOKE ALL ON FUNCTION public.begin_document_link_generation(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.begin_document_link_generation(text, uuid, text) TO authenticated, service_role;
