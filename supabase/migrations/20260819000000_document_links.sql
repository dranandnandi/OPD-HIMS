-- Stable, shareable PDF links.
--
-- Problem this solves (see supabase/migrations/stable-opd.md):
--   1. Nothing is shareable until the whole render→verify→download→upload chain
--      finishes. generate-pdf-from-html spends a 3s settle + up to 10 verify
--      fetches + up to 5 download retries *after* the PDF already exists at
--      pdf.co, and the caller waits for all of it.
--   2. When persistence fails, the code falls back to handing out the raw pdf.co
--      URL. pdf.co signs its S3 links for 3600s, so anything sent that way — and
--      the WhatsApp queue defers sends by minutes — becomes a dead link.
--
-- The fix: mint an unguessable token *before* generation and resolve it at open
-- time to whatever copy is live right now (permanent storage URL if there is
-- one, the pdf.co temp URL if not yet, a "preparing" page if neither).
--
-- Unlike the LIMS original this table is polymorphic: this app produces PDFs for
-- four record kinds across six (kind, variant) pairs.

-- ---------------------------------------------------------------------------
-- 0. Reconcile the bills PDF columns.
--
-- bills was created with pdf_url + print_pdf_url by the migrations, but the live
-- schema also carries a quoted CamelCase "printPdfUrl", and the edge function
-- writes the display URL to a "pdfUrl" column that does not exist at all. Net
-- effect today: bill display PDFs never cache (the UPDATE errors and is only
-- logged), so every open re-renders, and print URLs may land in either column
-- depending on which code path wrote them.
--
-- Converge on the snake_case names that visits already uses. Same defensive
-- shape as the existing fix_duplicated_pdf_columns.sql in this directory.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS pdf_url text;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS print_pdf_url text;

  -- Fold a stray "pdfUrl" into pdf_url, preferring whatever pdf_url already has.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'pdfUrl'
  ) THEN
    UPDATE public.bills SET pdf_url = COALESCE(pdf_url, "pdfUrl");
    ALTER TABLE public.bills DROP COLUMN "pdfUrl";
  END IF;

  -- Same for "printPdfUrl" → print_pdf_url.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'printPdfUrl'
  ) THEN
    UPDATE public.bills SET print_pdf_url = COALESCE(print_pdf_url, "printPdfUrl");
    ALTER TABLE public.bills DROP COLUMN "printPdfUrl";
  END IF;
END $$;

COMMENT ON COLUMN public.bills.pdf_url IS 'Permanent Storage URL of the display bill PDF. Never a pdf.co URL.';
COMMENT ON COLUMN public.bills.print_pdf_url IS 'Permanent Storage URL of the print (letterhead) bill PDF. Never a pdf.co URL.';

-- ---------------------------------------------------------------------------
-- 1. Per-tenant rollout gate. Default off; flip per clinic once proven.
-- ---------------------------------------------------------------------------
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS document_link_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clinic_settings.document_link_enabled IS
  'When true, PDF generation mints stable /r/<token>.pdf links and shares those instead of raw Storage URLs.';

-- Which branded domain this clinic's links are emitted on.
--
-- The app is served on more than one domain from the same site, so the link
-- domain follows the *clinic*, not the browser origin: the WhatsApp queue and
-- the edge functions both build links with no window.location to read from.
--
-- Set manually per clinic; there is deliberately no UI for it. NULL falls back
-- to the DOC_LINK_BASE / VITE_DOC_LINK_BASE environment value.
--
-- Must include the scheme. A bare 'opdapp.example.com/r' is a *relative* URL:
-- the browser resolves it against the app origin, the SPA catch-all answers
-- with index.html, and the link silently opens the app instead of the document.
-- The readers normalise a missing scheme defensively, but store it correctly.
--
-- Tokens are domain-independent — the same token resolves through any domain
-- carrying the /r/* rule, so changing this value repoints existing links rather
-- than invalidating them.
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS document_link_base text;

COMMENT ON COLUMN public.clinic_settings.document_link_base IS
  'Per-clinic public link prefix, e.g. https://opdapp.anprohealthtech.com/r. NULL uses the DOC_LINK_BASE env value.';

-- ---------------------------------------------------------------------------
-- 2. The link table.
--
-- entity_id carries no FK because the table is polymorphic across four parents;
-- deletion is handled by the triggers in section 5 instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_links (
  token            text PRIMARY KEY,
  clinic_id        uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  entity_type      text NOT NULL CHECK (entity_type IN ('visit', 'bill', 'ipd_bill', 'ipd_document')),
  entity_id        uuid NOT NULL,
  variant          text NOT NULL CHECK (variant IN ('display', 'print', 'compact', 'final')),

  -- permanent_url is a Storage URL and ONLY ever a Storage URL. The writer
  -- refuses ephemeral input; that guard is what stops a failed upload from
  -- freezing a link that dies within the hour.
  permanent_url    text,
  temp_url         text,
  temp_expires_at  timestamptz,

  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'temp', 'permanent', 'failed')),

  first_shared_at  timestamptz,
  last_accessed_at timestamptz,
  access_count     integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_links_entity_variant
  ON public.document_links (entity_type, entity_id, variant);

CREATE INDEX IF NOT EXISTS idx_document_links_clinic
  ON public.document_links (clinic_id, created_at DESC);

COMMENT ON TABLE public.document_links IS
  'Stable public tokens for generated PDFs. Resolved at open time by the doc-link edge function.';

-- ---------------------------------------------------------------------------
-- 3. Race-safe minting.
--
-- Concurrent callers (a user hitting Print twice, an auto-send racing the UI)
-- must converge on ONE token per (entity, variant) — otherwise the second
-- caller mints a token nobody ever stamps a URL onto.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_document_link(
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
  v_token     text;
  v_clinic_id uuid;
BEGIN
  IF p_entity_type NOT IN ('visit', 'bill', 'ipd_bill', 'ipd_document') THEN
    RAISE EXCEPTION 'unknown entity_type %', p_entity_type;
  END IF;
  IF p_variant NOT IN ('display', 'print', 'compact', 'final') THEN
    RAISE EXCEPTION 'unknown variant %', p_variant;
  END IF;

  -- Resolve the owning clinic FIRST, before any early return, so the tenant
  -- guard below covers the "token already exists" path too.
  CASE p_entity_type
    WHEN 'visit'        THEN SELECT clinic_id INTO v_clinic_id FROM visits        WHERE id = p_entity_id;
    WHEN 'bill'         THEN SELECT clinic_id INTO v_clinic_id FROM bills         WHERE id = p_entity_id;
    WHEN 'ipd_bill'     THEN SELECT clinic_id INTO v_clinic_id FROM ipd_bills     WHERE id = p_entity_id;
    WHEN 'ipd_document' THEN SELECT clinic_id INTO v_clinic_id FROM ipd_documents WHERE id = p_entity_id;
  END CASE;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION '% % not found, or has no clinic_id', p_entity_type, p_entity_id;
  END IF;

  -- Tenant guard.
  --
  -- SECURITY DEFINER is required (the function writes a table nobody has direct
  -- INSERT on), but it also means RLS does not protect this call: without the
  -- check below, any signed-in user could mint a token for another clinic's
  -- record and then read that document anonymously through the resolver.
  -- The service role — the generators and the resolver — is exempt.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND clinic_id = v_clinic_id
    ) THEN
      RAISE EXCEPTION 'not permitted to create a link for this record';
    END IF;
  END IF;

  SELECT token INTO v_token
    FROM document_links
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND variant = p_variant;
  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  INSERT INTO document_links (token, clinic_id, entity_type, entity_id, variant)
  VALUES (replace(gen_random_uuid()::text, '-', ''), v_clinic_id, p_entity_type, p_entity_id, p_variant)
  ON CONFLICT (entity_type, entity_id, variant) DO NOTHING
  RETURNING token INTO v_token;

  IF v_token IS NULL THEN
    -- Lost the race; read the winner's token rather than minting a second one.
    SELECT token INTO v_token
      FROM document_links
     WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND variant = p_variant;
  END IF;

  RETURN v_token;
END $$;

REVOKE ALL ON FUNCTION public.ensure_document_link(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ensure_document_link(text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS.
--
-- Staff read their own clinic's links. Nobody writes through this path — the
-- generator and the resolver both use the service role, which bypasses RLS.
-- The whole point of the token is that an *anonymous* bearer can resolve it,
-- and that resolution happens inside the edge function, not through PostgREST.
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

-- RLS filters rows; it does not grant access to the table in the first place.
-- Both are needed for the app to read link status.
GRANT SELECT ON public.document_links TO authenticated;
GRANT ALL    ON public.document_links TO service_role;

DROP POLICY IF EXISTS "Staff read own clinic document links" ON public.document_links;
CREATE POLICY "Staff read own clinic document links"
  ON public.document_links FOR SELECT
  TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Parent deletion cleanup.
--
-- entity_id has no FK (polymorphic), so cascade by hand. Without this a deleted
-- visit leaves a token that resolves to a Storage URL for a record that no
-- longer exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_document_links_for_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM document_links
   WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_document_links_cleanup ON public.visits;
CREATE TRIGGER trg_document_links_cleanup
  AFTER DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_links_for_parent('visit');

DROP TRIGGER IF EXISTS trg_document_links_cleanup ON public.bills;
CREATE TRIGGER trg_document_links_cleanup
  AFTER DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_links_for_parent('bill');

DROP TRIGGER IF EXISTS trg_document_links_cleanup ON public.ipd_bills;
CREATE TRIGGER trg_document_links_cleanup
  AFTER DELETE ON public.ipd_bills
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_links_for_parent('ipd_bill');

DROP TRIGGER IF EXISTS trg_document_links_cleanup ON public.ipd_documents;
CREATE TRIGGER trg_document_links_cleanup
  AFTER DELETE ON public.ipd_documents
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_links_for_parent('ipd_document');

-- ---------------------------------------------------------------------------
-- 6. updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_document_links_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_document_links_touch ON public.document_links;
CREATE TRIGGER trg_document_links_touch
  BEFORE UPDATE ON public.document_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_document_links_updated_at();
