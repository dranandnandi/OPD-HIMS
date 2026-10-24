import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { handleConnector } from '../_shared/suite-connector-core.ts';

// This file is also installed in Growth and Workforce with a fixed component.
const COMPONENT = 'opd' as const;
export function handleSuiteConnector(req: Request): Promise<Response> {
  const client = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handleConnector(req, {
    component: COMPONENT, token: Deno.env.get('SUITE_CONNECTOR_TOKEN'),
    instanceId: Deno.env.get('SUITE_INSTANCE_ID'), environment: Deno.env.get('SUITE_ENVIRONMENT'),
  }, {
    async health() {
      const { error } = await client().from('profiles').select('id,user_id,clinic_id').limit(1);
      if (error) throw error;
    },
    async identity(id) {
      const { data, error } = await client().from('profiles').select('id,user_id,clinic_id').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? { local_user_id: String(data.id), local_auth_id: data.user_id, local_tenant_id: data.clinic_id } : null;
    },
  });
}
if (import.meta.main) Deno.serve(handleSuiteConnector);
