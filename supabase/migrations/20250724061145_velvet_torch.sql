/*
  # Add role_name and permissions to profiles table

  1. Schema Changes
    - Add `role_name` column to profiles table (TEXT)
    - Add `permissions` column to profiles table (TEXT[])
    - Keep existing `role_id` column and foreign key for reference
    - Populate new columns with data from roles table

  2. Data Migration
    - Update existing profiles with role_name and permissions from roles table
    - Ensure data consistency between roles table and denormalized columns

  3. Performance Benefits
    - Eliminates need for joins in getCurrentProfile function
    - Faster profile lookups while maintaining referential integrity
*/

-- Add new columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS role_name TEXT,
ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

-- Populate role_name and permissions from roles table for existing profiles
UPDATE profiles 
SET 
  role_name = roles.name,
  permissions = roles.permissions
FROM roles 
WHERE profiles.role_id = roles.id 
AND (profiles.role_name IS NULL OR profiles.permissions IS NULL);

-- Create index for better performance on role_name queries
CREATE INDEX IF NOT EXISTS idx_profiles_role_name ON profiles(role_name);

-- Create function to automatically sync role data when role_id changes
CREATE OR REPLACE FUNCTION sync_profile_role_data()
RETURNS TRIGGER AS $$
BEGIN
  -- If role_id is being updated, sync role_name and permissions
  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT name, permissions 
    INTO NEW.role_name, NEW.permissions
    FROM roles 
    WHERE id = NEW.role_id;
    
    -- If role not found, set defaults
    IF NEW.role_name IS NULL THEN
      NEW.role_name := 'user';
      NEW.permissions := '{}';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically sync role data
DROP TRIGGER IF EXISTS trigger_sync_profile_role_data ON profiles;
CREATE TRIGGER trigger_sync_profile_role_data
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_role_data();

-- Create function to sync role data when inserting new profiles
CREATE OR REPLACE FUNCTION sync_profile_role_data_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync role_name and permissions from roles table
  IF NEW.role_id IS NOT NULL THEN
    SELECT name, permissions 
    INTO NEW.role_name, NEW.permissions
    FROM roles 
    WHERE id = NEW.role_id;
    
    -- If role not found, set defaults
    IF NEW.role_name IS NULL THEN
      NEW.role_name := 'user';
      NEW.permissions := '{}';
    END IF;
  ELSE
    -- Set defaults if no role_id provided
    NEW.role_name := 'user';
    NEW.permissions := '{}';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for insert operations
DROP TRIGGER IF EXISTS trigger_sync_profile_role_data_insert ON profiles;
CREATE TRIGGER trigger_sync_profile_role_data_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_role_data_insert();