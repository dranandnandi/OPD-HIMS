/*
  # Add clinic_id to medicines_master table

  1. Schema Changes
    - Add `clinic_id` column to `medicines_master` table
    - Set default value for existing records
    - Add NOT NULL constraint
    - Add foreign key constraint to `clinic_settings`
    - Add index for performance

  2. Security
    - Enable RLS on `medicines_master` table
    - Add policies to restrict access by clinic_id
    - Users can only access medicines from their assigned clinic

  3. Data Migration
    - Populate existing records with default clinic_id
    - Ensure data integrity during migration
*/

-- Step 1: Add clinic_id column (nullable initially)
ALTER TABLE public.medicines_master 
ADD COLUMN IF NOT EXISTS clinic_id UUID;

-- Step 2: Set default clinic_id for existing records
-- Get the first clinic_id from clinic_settings as default
DO $$
DECLARE
    default_clinic_id UUID;
BEGIN
    -- Get the first clinic ID as default
    SELECT id INTO default_clinic_id 
    FROM public.clinic_settings 
    LIMIT 1;
    
    -- Update existing records with default clinic_id
    IF default_clinic_id IS NOT NULL THEN
        UPDATE public.medicines_master 
        SET clinic_id = default_clinic_id 
        WHERE clinic_id IS NULL;
    END IF;
END $$;

-- Step 3: Add NOT NULL constraint
ALTER TABLE public.medicines_master 
ALTER COLUMN clinic_id SET NOT NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE public.medicines_master 
ADD CONSTRAINT medicines_master_clinic_id_fkey 
FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id) ON DELETE CASCADE;

-- Step 5: Add index for performance
CREATE INDEX IF NOT EXISTS idx_medicines_master_clinic_id 
ON public.medicines_master USING btree (clinic_id);

-- Step 6: Enable RLS
ALTER TABLE public.medicines_master ENABLE ROW LEVEL SECURITY;

-- Step 7: Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow admin to manage medicines_master" ON public.medicines_master;
DROP POLICY IF EXISTS "Allow all authenticated users to view medicines_master" ON public.medicines_master;
DROP POLICY IF EXISTS "Allow authenticated users to insert medicines_master" ON public.medicines_master;
DROP POLICY IF EXISTS "Allow authenticated users to update medicines_master" ON public.medicines_master;

-- Step 8: Create new RLS policies with clinic_id filtering
CREATE POLICY "Users can only access medicines from their clinic"
ON public.medicines_master
FOR ALL
TO authenticated
USING (clinic_id = get_current_user_clinic_id())
WITH CHECK (clinic_id = get_current_user_clinic_id());

-- Step 9: Create admin policy for full access within clinic
CREATE POLICY "Admins can manage medicines within their clinic"
ON public.medicines_master
FOR ALL
TO authenticated
USING (
  clinic_id = get_current_user_clinic_id() AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role_name IN ('admin', 'super_admin')
    AND profiles.clinic_id = get_current_user_clinic_id()
  )
)
WITH CHECK (
  clinic_id = get_current_user_clinic_id() AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role_name IN ('admin', 'super_admin')
    AND profiles.clinic_id = get_current_user_clinic_id()
  )
);

-- Step 10: Update trigger function to set clinic_id automatically
CREATE OR REPLACE FUNCTION set_clinic_id_medicines_master()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := get_current_user_clinic_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 11: Create trigger to auto-set clinic_id on insert
DROP TRIGGER IF EXISTS trigger_set_clinic_id_medicines_master ON public.medicines_master;
CREATE TRIGGER trigger_set_clinic_id_medicines_master
  BEFORE INSERT ON public.medicines_master
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_medicines_master();