import { guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AvailableComponent = { code: string; type?: "earning" | "deduction" | "employer_cost" };

function buildMap(available: AvailableComponent[]) {
  const allowed = new Set<string>();
  const map: Record<string, string> = {};
  
  for (const a of available) { 
    allowed.add(a.code); 
    map[a.code] = a.code; 
    map[a.code.toUpperCase()] = a.code; 
    map[a.code.toLowerCase()] = a.code; 
  }
  
  const prefer = (alias: string, target: string) => { 
    if (allowed.has(target)) map[alias] = target; 
  };
  
  // Common AI aliases to your database codes
  prefer("PF", "PF_EE");
  prefer("pf", "PF_EE");
  prefer("ESI", "esic_employee");
  prefer("esi", "esic_employee");
  prefer("SPEC", "special");
  prefer("MED", "MED");
  prefer("basic", "BASIC"); 
  prefer("hra", "HRA"); 
  prefer("conveyance", "CONV");
  prefer("pt", "PT"); 
  prefer("tds", "TDS");
  
  return { allowed, map };
}

function finalize(components: { component_code: string; amount: number }[], available: AvailableComponent[]) {
  const { allowed, map } = buildMap(available);
  const typeByCode = new Map(available.map((component) => [component.code, component.type]));
  const acc = new Map<string, number>();
  const unmapped: { raw_code: string; amount: number }[] = [];

  for (const l of components || []) {
    const raw = String(l.component_code || "");
    const code = map[raw] || map[raw.toUpperCase()] || map[raw.toLowerCase()] || (allowed.has(raw) ? raw : null);
    
    if (!code || !allowed.has(code)) { 
      unmapped.push({ raw_code: raw, amount: Number(l.amount) || 0 }); 
      continue; 
    }
    
    let amt = Number(l.amount) || 0;
    const type = typeByCode.get(code);
    if (type === "deduction" && amt > 0) amt = -amt;
    if (type !== "deduction" && amt < 0) amt = Math.abs(amt);

    acc.set(code, (acc.get(code) || 0) + amt);
  }

  const out = Array.from(acc.entries()).map(([component_code, amount]) => ({ 
    component_code, 
    amount: Math.round(amount) 
  }));
  
  const ctc_annual = out.filter(o => o.amount > 0).reduce((s, o) => s + o.amount, 0);
  return { components: out, ctc_annual, unmapped };
}

serve(guardEdge(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { 
    status: 405, 
    headers: { ...corsHeaders, "Content-Type": "application/json" } 
  });
  
  try {
    const body = await req.json();
    const { draft_compensation, available_components = [] } = body || {};
    
    const result = finalize(draft_compensation?.components || [], available_components);
    
    return new Response(JSON.stringify({
      compensation: {
        ctc_annual: result.ctc_annual,
        pay_schedule: "monthly",
        currency: draft_compensation?.currency || "INR",
        components: result.components,
        notes: draft_compensation?.notes || "Finalized by mapper"
      },
      unmapped: result.unmapped
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}, 'workforce', 'ai-component-mapper'));
