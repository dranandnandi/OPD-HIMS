import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// supabase/functions/organizations-list/index.ts
import { supabaseAdmin, ok, bad, cors } from "../_shared/utils.ts";

Deno.serve(guardEdge(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const sb = supabaseAdmin();
    
    const { data: organizations, error } = await sb
      .from('organizations')
      .select('id, name, created_at')
      .order('name');

    if (error) {
      console.error('Organizations query error:', error);
      return bad(error.message, { headers, status: 500 });
    }

    return ok({ organizations: organizations || [] }, { headers });
    
  } catch (e: any) {
    console.error('Organizations list error:', e);
    return bad(e?.message || 'Internal server error', { headers, status: 500 });
  }
}, 'workforce', 'organizations-list'));