/*
  # Fix clinic medicine prices RLS policies (idempotent)

  - Ensures RLS is enabled
  - Drops any existing policies to avoid 42710 duplicate-name errors
  - Recreates clinic-scoped CRUD policies
*/

-- 0) Ensure RLS is on
ALTER TABLE public.clinic_medicine_prices ENABLE ROW LEVEL SECURITY;

-- 1) Drop any existing policies (avoids: 42710 policy ... already exists)
DROP POLICY IF EXISTS "Admin can manage medicine prices" ON public.clinic_medicine_prices;
DROP POLICY IF EXISTS "Users can read their clinic's medicine prices" ON public.clinic_medicine_prices;
DROP POLICY IF EXISTS "Users can insert medicine prices for their clinic" ON public.clinic_medicine_prices;
DROP POLICY IF EXISTS "Users can update their clinic's medicine prices" ON public.clinic_medicine_prices;
DROP POLICY IF EXISTS "Users can delete their clinic's medicine prices" ON public.clinic_medicine_prices;

-- 2) Create policies (change TO public -> TO authenticated if you want only signed-in users)
CREATE POLICY "Users can read their clinic's medicine prices"
ON public.clinic_medicine_prices
FOR SELECT
TO public
USING (
  clinic_id IN (
    SELECT profiles.clinic_id
    FROM profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Users can insert medicine prices for their clinic"
ON public.clinic_medicine_prices
FOR INSERT
TO public
WITH CHECK (
  clinic_id IN (
    SELECT profiles.clinic_id
    FROM profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Users can update their clinic's medicine prices"
ON public.clinic_medicine_prices
FOR UPDATE
TO public
USING (
  clinic_id IN (
    SELECT profiles.clinic_id
    FROM profiles
    WHERE profiles.id = auth.uid()
  )
)
WITH CHECK (
  clinic_id IN (
    SELECT profiles.clinic_id
    FROM profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Users can delete their clinic's medicine prices"
ON public.clinic_medicine_prices
FOR DELETE
TO public
USING (
  clinic_id IN (
    SELECT profiles.clinic_id
    FROM profiles
    WHERE profiles.id = auth.uid()
  )
);
