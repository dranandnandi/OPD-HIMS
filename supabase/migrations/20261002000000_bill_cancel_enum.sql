/*
  # Add 'cancelled' to the OPD bill status enum

  Kept in its own migration on purpose: Postgres will not let a new enum value
  be USED in the same transaction that adds it, and the Supabase CLI runs each
  migration file in one transaction. The columns, guards and cancel function
  that reference 'cancelled' therefore live in 20261002000001.
*/

ALTER TYPE public.bill_payment_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
