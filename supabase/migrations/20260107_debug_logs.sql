-- Create a debug_logs table to capture database events and errors
-- This effectively acts as a "console.log" for your database triggers
CREATE TABLE IF NOT EXISTS public.debug_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT,
    message TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (optional, depends on who should see logs)
ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert logs (so triggers running as user can log)
CREATE POLICY "Allow insert for authenticated" ON public.debug_logs
FOR INSERT TO authenticated WITH CHECK (true);

-- Allow service_role to do everything
CREATE POLICY "Allow all for service role" ON public.debug_logs
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow you (the developer) to view logs via dashboard
CREATE POLICY "Allow select for authenticated" ON public.debug_logs
FOR SELECT TO authenticated USING (true);
