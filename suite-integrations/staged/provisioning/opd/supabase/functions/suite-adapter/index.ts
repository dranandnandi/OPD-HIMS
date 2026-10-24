import{ensureLegacyUsers,legacyCheckpoint}from'../_shared/suite-legacy-sync.ts';
import{createClient}from'npm:@supabase/supabase-js@2.51.0';
import{handleAdapter,AccessError,record}from'../_shared/suite-runtime-core.ts';
import{applySupabaseSnapshot}from'../_shared/suite-runtime-store.ts';
import{RUNTIME_REVISION}from'../_shared/suite-runtime-guard.ts';
export async function handleSuiteAdapter(req:Request){return handleAdapter(req,{product:'opd',token:Deno.env.get('SUITE_ADAPTER_TOKEN'),instance:Deno.env.get('SUITE_INSTANCE_ID'),environment:Deno.env.get('SUITE_ENVIRONMENT')},{async apply(snapshot){
 if(Deno.env.get('SUITE_RUNTIME_ENABLED')!=='true'||RUNTIME_REVISION!=='suite.runtime.v1')throw new AccessError('Product runtime is not enabled.',503);
 const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await applySupabaseSnapshot(client,snapshot,'opd');await ensureLegacyUsers('opd',result.identities,{url:Deno.env.get('SUITE_LEGACY_USER_SYNC_URL'),token:Deno.env.get('SUITE_LEGACY_USER_SYNC_TOKEN'),checkpoint:legacyCheckpoint(client)});const coverage=await client.rpc('ds_runtime_coverage');
 if(coverage.error)throw new AccessError('Product schema coverage is unavailable.',503);const checks=record(coverage.data);
 return{local_tenant_id:String(result.local_tenant_id),version:Number(result.version),identities:result.identities,enforcement:{server:checks.database_ready===true&&checks.rpc_ready===true,workers:false,expires_at:true,tenant_isolation:checks.database_ready===true&&checks.rpc_ready===true}};
 }});}
if(import.meta.main)Deno.serve(handleSuiteAdapter);
