-- ============================================================================
-- IPD Migration 009: Nightly room-rent posting via pg_cron
-- Posts one bed-day charge (room rent + nursing) per open allocation,
-- shortly after midnight IST. Uses the IST calendar date explicitly so the
-- UTC-based cron clock cannot post for the wrong day.
-- post_room_rent_for_date() is idempotent, so re-runs are safe.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove a previous schedule if this migration is re-applied
DO $$
BEGIN
  PERFORM cron.unschedule('ipd-room-rent-daily');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job did not exist yet
END $$;

-- 18:45 UTC = 00:15 IST — just after the hospital day rolls over
SELECT cron.schedule(
  'ipd-room-rent-daily',
  '45 18 * * *',
  $$SELECT public.post_room_rent_for_date((now() AT TIME ZONE 'Asia/Kolkata')::date)$$
);

COMMIT;
