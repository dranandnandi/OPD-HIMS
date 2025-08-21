/*
  # Migrate Existing Pricing Data

  1. Data Migration
    - Copy existing medicine prices from medicines_master to clinic_medicine_prices
    - Copy existing test prices from tests_master to clinic_test_prices
    - Apply to all existing clinics

  2. Schema Updates
    - Remove price columns from medicines_master and tests_master
    - These will now be managed through clinic-specific pricing tables
*/

-- Migrate existing medicine prices to all clinics
INSERT INTO clinic_medicine_prices (clinic_id, medicine_id, selling_price, cost_price)
SELECT 
  cs.id as clinic_id,
  mm.id as medicine_id,
  COALESCE(mm.selling_price, 0) as selling_price,
  COALESCE(mm.cost_price, 0) as cost_price
FROM clinic_settings cs
CROSS JOIN medicines_master mm
WHERE mm.is_active = true
  AND (mm.selling_price IS NOT NULL OR mm.cost_price IS NOT NULL)
ON CONFLICT (clinic_id, medicine_id) DO NOTHING;

-- Migrate existing test prices to all clinics
INSERT INTO clinic_test_prices (clinic_id, test_id, price, cost)
SELECT 
  cs.id as clinic_id,
  tm.id as test_id,
  COALESCE(tm.cost, 0) as price,
  COALESCE(tm.cost, 0) as cost
FROM clinic_settings cs
CROSS JOIN tests_master tm
WHERE tm.is_active = true
  AND tm.cost IS NOT NULL
ON CONFLICT (clinic_id, test_id) DO NOTHING;

-- Remove pricing columns from medicines_master
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'medicines_master' AND column_name = 'selling_price'
  ) THEN
    ALTER TABLE medicines_master DROP COLUMN selling_price;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'medicines_master' AND column_name = 'cost_price'
  ) THEN
    ALTER TABLE medicines_master DROP COLUMN cost_price;
  END IF;
END $$;

-- Remove pricing columns from tests_master
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tests_master' AND column_name = 'cost'
  ) THEN
    ALTER TABLE tests_master DROP COLUMN cost;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tests_master' AND column_name = 'price'
  ) THEN
    ALTER TABLE tests_master DROP COLUMN price;
  END IF;
END $$;