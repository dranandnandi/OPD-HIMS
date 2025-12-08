-- Drop existing policies for suppliers table
DROP POLICY IF EXISTS "Admin can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Allow all authenticated users to view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Allow all authenticated users to manage suppliers" ON public.suppliers;

-- Allow all authenticated users to manage suppliers (INSERT, UPDATE, DELETE)
CREATE POLICY "Allow authenticated users to manage suppliers"
ON public.suppliers
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
