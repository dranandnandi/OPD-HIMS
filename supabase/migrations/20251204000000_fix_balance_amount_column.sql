-- Fix balance_amount column - remove GENERATED constraint
-- This allows the trigger to update it properly

ALTER TABLE public.bills 
  ALTER COLUMN balance_amount DROP EXPRESSION IF EXISTS;

-- Ensure the column can be updated
ALTER TABLE public.bills 
  ALTER COLUMN balance_amount DROP DEFAULT;

ALTER TABLE public.bills 
  ALTER COLUMN balance_amount SET DEFAULT 0;
