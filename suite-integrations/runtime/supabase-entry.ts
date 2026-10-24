import{createClient}from'npm:@supabase/supabase-js@2.51.0';
import{AccessError,record,uuid,type Product}from'./access-core.ts';
export function productEntry(product:Exclude<Product,'whatsapp'>){return async(req:Request)=>{
 const origin=req.headers.get('Origin'),origins=(Deno.env.get('SUITE_PRODUCT_ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim()).filter(Boolean);
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'};
 if(origin&&origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(origin&&!origins.includes(origin))return reply({error:'Origin is not allowed.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Use POST.'},405);
 try{
  if(Deno.env.get('SUITE_RUNTIME_ENABLED')!=='true')throw new AccessError('Suite login is not enabled.',503);
  const raw=await req.text();if(raw.length>2048)throw new AccessError('Request too large.',413);
  let input:Record<string,unknown>;try{input=record(JSON.parse(raw));}catch{throw new AccessError('Invalid request.',400);}
  if(typeof input.ticket!=='string'||!/^[a-f0-9]{64}$/.test(input.ticket))throw new AccessError('Invalid login link.');
  const central=Deno.env.get('SUITE_ACCESS_URL'),token=Deno.env.get('SUITE_ACCESS_TOKEN'),instance=Deno.env.get('SUITE_INSTANCE_ID');
  if(!central||!token||token.length<32||!instance)throw new AccessError('Product login is not configured.',503);
  const target=new URL(central);if(target.protocol!=='https:'||target.username||target.password||target.hash||target.search)throw new AccessError('Invalid central access configuration.',503);
  const response=await fetch(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'redeem_launch',ticket:input.ticket,instance_id:uuid(instance)})});
  if(!response.ok)throw new AccessError('Login link expired or access is no longer active.');
  const identity=record(await response.json());if(identity.product_code!==product||typeof identity.local_auth_id!=='string')throw new AccessError('Product identity mismatch.');
  const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
  const actual=await client.auth.admin.getUserById(uuid(identity.local_auth_id));
  if(actual.error||!actual.data.user?.email_confirmed_at||!actual.data.user.email)throw new AccessError('The linked product account is unavailable.');
  const state=await client.rpc('ds_runtime_user_status',{p_auth:actual.data.user.id});
  if(state.error||state.data?.managed!==true||state.data?.allowed!==true||state.data.local_tenant_id!==identity.local_tenant_id||state.data.local_user_id!==identity.local_user_id)throw new AccessError('Product account access is not ready.');
  const generated=await client.auth.admin.generateLink({type:'magiclink',email:actual.data.user.email});
  if(generated.error||generated.data.user.id!==actual.data.user.id||!generated.data.properties.hashed_token)throw new AccessError('Product sign-in could not be issued.',503);
  return reply({token_hash:generated.data.properties.hashed_token,local_auth_id:actual.data.user.id});
 }catch(e){return reply({error:e instanceof AccessError?e.message:'Product login is unavailable.'},e instanceof AccessError?e.status:503);}
};}
