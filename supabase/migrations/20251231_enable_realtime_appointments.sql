-- Enable Realtime for appointments table
-- This allows Supabase to broadcast INSERT, UPDATE, and DELETE events to subscribed clients

-- Enable Realtime replication for appointments
alter publication supabase_realtime add table appointments;

-- Optionally, you can also enable for visits and patients tables for future use
-- alter publication supabase_realtime add table visits;
-- alter publication supabase_realtime add table patients;
