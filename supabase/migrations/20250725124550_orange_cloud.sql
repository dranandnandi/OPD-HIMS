/*
  # Add procedure type to test_type_enum

  1. Schema Changes
    - Add 'procedure' as a new value to the test_type_enum
    - This allows tests_master table to store procedure definitions
    - Procedures will be treated as a special type of test with different billing categorization

  2. Purpose
    - Enable procedures to be stored in the same tests_master table
    - Allow segregation of tests vs procedures in the UI
    - Maintain single source of truth for all test/procedure master data
*/

-- Add 'procedure' to the existing test_type_enum
ALTER TYPE test_type_enum ADD VALUE 'procedure';

-- Update any existing records if needed (optional, for data migration)
-- This is just an example - adjust based on your actual data needs
-- UPDATE tests_master SET type = 'procedure' WHERE category = 'surgical' OR name ILIKE '%surgery%' OR name ILIKE '%procedure%';