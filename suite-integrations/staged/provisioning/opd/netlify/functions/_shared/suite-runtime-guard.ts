import{AsyncLocalStorage}from'node:async_hooks';
import{createClient as sdkCreateClient}from'@supabase/supabase-js';
import{AccessError,record,sameSecret,type Product}from'./suite-runtime-core';
import{verifyNotificationContext}from'./notification-context.ts';
declare const Deno:{env:{get(name:string):string|undefined}};
const env=(name:string)=>typeof Deno!=='undefined'?Deno.env.get(name):(globalThis as unknown as {process?:{env:Record<string,string|undefined>}}).process?.env[name];
export const RUNTIME_REVISION='suite.runtime.v1';
type Scope={product:Product;tenant?:string;subject?:string;bearer?:string;machine:boolean;managed:boolean;role?:string;identityOnly?:boolean;queuedAt?:string};
const contexts=new AsyncLocalStorage<Scope>();
const nativeFetch=globalThis.fetch;
const enabled=()=>env('SUITE_RUNTIME_ENABLED')==='true';
export const requiredRuntimeEnv=(name:string)=>{const value=env(name);if(!value)throw new AccessError('Required server setting is missing: '+name,503);return value;};
function localClient(){return sdkCreateClient(requiredRuntimeEnv('SUPABASE_URL'),requiredRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:nativeFetch}});}
async function rpc(name:string,args:Record<string,unknown>){const result=await localClient().rpc(name,args);if(result.error)throw new AccessError('Suite access is unavailable, expired, suspended or outside this account.',403);return result.data;}
async function requestBody(req:Request){const body:Record<string,unknown>=Object.fromEntries(new URL(req.url).searchParams);if(req.headers.get('Content-Type')?.includes('application/json')){const raw=await req.clone().text();if(raw.length>2000000)throw new AccessError('Request is too large.',413);try{Object.assign(body,record(JSON.parse(raw)));}catch(e){if(e instanceof AccessError)throw e;throw new AccessError('Invalid JSON.',400);}}return body;}
async function authenticate(req:Request){
 const bearer=req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
 const secrets:[string|undefined,string|undefined][]=[
  [bearer,env('SUPABASE_SERVICE_ROLE_KEY')],[bearer,env('SUITE_LOCAL_WORKER_TOKEN')],
  [req.headers.get('x-hims-bot-secret')||undefined,env('HIMS_BOT_SECRET')],
  [req.headers.get('x-cron-secret')||undefined,env('CRON_SECRET')],
  [req.headers.get('x-webhook-secret')||undefined,env('WHATSAPP_USER_SYNC_SECRET')],
  [req.headers.get('x-webhook-secret')||undefined,env('SYNC_USER_WEBHOOK_SECRET')],
 ];
 for(const[actual,expected]of secrets)if(actual&&expected&&expected.length>=16&&actual.length<=2048&&await sameSecret(actual,expected))return{machine:true};
 if(!bearer)throw new AccessError('Sign in or use the configured server credential.',401);
 const result=await localClient().auth.getUser(bearer);
 if(result.error||!result.data.user)throw new AccessError('Session is invalid or expired.',401);
 return{machine:false,subject:result.data.user.id,bearer};
}
async function resolve(body:Record<string,unknown>,subject?:string){return record(await rpc('ds_runtime_request_context',{p_body:body,p_auth:subject||null}));}
export async function withRequestScope<T>(req:Request,product:Product,name:string,work:()=>Promise<T>):Promise<T>{
 if(!enabled()||req.method==='OPTIONS')return work();
 const auth=await authenticate(req),state=await resolve(await requestBody(req),auth.subject);
 if(state.managed===true&&['create-user','delete-user','restore-user','update-user','reset-user-password','fix-whatsapp-numbers'].includes(name))throw new AccessError('Manage suite identities and roles in Suite Admin.');
 return contexts.run({...auth,product,tenant:typeof state.local_tenant_id==='string'?state.local_tenant_id:undefined,managed:state.managed===true,role:typeof state.role==='string'?state.role:undefined},work);
}
export function guardEdge(handler:(req:Request)=>Response|Promise<Response>,product:Product,name:string){return async(req:Request)=>{
 try{if(enabled()&&req.method!=='OPTIONS'&&name==='sync-user-to-neon')return await provisionRequest(req,product,name,handler);return await withRequestScope(req,product,name,async()=>await handler(req));}
 catch(e){return Response.json({error:e instanceof AccessError?e.message:'Product access could not be verified.'},{status:e instanceof AccessError?e.status:503,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':req.headers.get('Origin')||'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});}
};}
export function guardNetlify<T extends(...args:any[])=>any>(handler:T,product:Product,name:string,scheduled=false):T{
 return(async(...args:Parameters<T>)=>{
  if(!enabled())return handler(...args);
  try{
   if(scheduled)return await contexts.run({product,machine:true,managed:false},()=>handler(...args));
   const event=args[0]||{},headers=new Headers();for(const[key,value]of Object.entries(event.headers||{}))if(typeof value==='string')headers.set(key,value);
   const method=event.httpMethod||'POST';const request=new Request(event.rawUrl||'https://suite.internal/'+name,{method,headers,...!['GET','HEAD'].includes(method)?{body:event.body||undefined}:{}});
   if(method!=='OPTIONS'&&['webhook-sync-user','sync-user-to-whatsapp-db'].includes(name))return await provisionRequest(request,product,name,async trusted=>handler({...event,body:await trusted.text()},...args.slice(1)));
   return await withRequestScope(request,product,name,()=>handler(...args));
  }catch(e){return{statusCode:e instanceof AccessError?e.status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:e instanceof AccessError?e.message:'Product access could not be verified.'})};}
 })as T;
}
async function provisionRequest<T>(req:Request,product:Product,name:string,work:(trusted:Request)=>T|Promise<T>):Promise<T>{
 const auth=await authenticate(req);
 const body=await requestBody(req);const candidate=body.record&&typeof body.record==='object'?record(body.record):body;
 const id=String(candidate.id||candidate.userId||candidate.authId||candidate.auth_id||'');if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw new AccessError('An exact source profile ID is required.',400);
 const table=product==='opd'?'profiles':'users';
 const found=await localClient().from(table).select('*').eq('id',id).maybeSingle();
 if(found.error||!found.data)throw new AccessError('Source profile could not be verified.');
 const row=found.data,authId=row.auth_id||row.user_id||row.id;
 if(!auth.machine&&authId!==auth.subject)throw new AccessError('You may only synchronise your verified source identity.');
 if(!auth.machine)await resolve({userId:row.id},auth.subject);
 const normalized={...row,userId:row.id,authId,auth_id:authId,username:row.username||row.email,email:row.email||row.contact_email||row.username,name:row.name,fullName:row.name,role:row.role||row.role_name||'user'};
 const payload=name==='sync-user-to-neon'?{record:row}:normalized;
 const trusted=new Request(req,{body:JSON.stringify(payload)});
 return contexts.run({product,machine:true,managed:false,identityOnly:true},()=>work(trusted));
}
export async function withTenant<T>(tenant:string,work:()=>Promise<T>,queuedAt?:string){
 const previous=contexts.getStore();if(!enabled()||!previous)return work();
 await rpc('ds_runtime_assert',{p_tenant:tenant});
 if(previous.subject&&previous.tenant&&previous.tenant!==tenant)throw new AccessError('Tenant differs from the signed-in account.');
 return contexts.run({...previous,tenant,queuedAt},work);
}
export async function withUser<T>(userId:string,work:()=>Promise<T>){
 const previous=contexts.getStore();if(!enabled()||!previous)return work();
 const state=await resolve({userId},previous.subject);const tenant=state.local_tenant_id;
 if(typeof tenant!=='string')throw new AccessError('Sender tenant could not be verified.');
 return contexts.run({...previous,tenant},work);
}
export async function assertDispatch(tenant:string,purpose:string,created?:string){
 if(!enabled())return;
 await rpc('ds_runtime_dispatch',{p_tenant:tenant,p_purpose:purpose,p_created:created||null});
}
export async function runtimeFetch(input:RequestInfo|URL,options?:RequestInit):Promise<Response>{
 const scope=contexts.getStore();if(!enabled()||!scope)return nativeFetch(input,options);
 const request=new Request(input,options);const url=new URL(request.url),local=new URL(requiredRuntimeEnv('SUPABASE_URL'));
 if(url.origin===local.origin&&url.pathname.startsWith('/auth/'))return nativeFetch(input,options);
 if(url.origin===local.origin&&url.pathname.startsWith('/rest/')){
  if(scope.subject&&scope.bearer){const headers=new Headers(request.headers);headers.set('Authorization',`Bearer ${scope.bearer}`);return nativeFetch(new Request(request,{headers}));}
  return nativeFetch(input,options);
 }
 if(scope.identityOnly){if(!['/webhook-sync-user','/sync-user-to-neon'].some(path=>url.pathname.endsWith(path)))throw new AccessError('Identity synchronisation cannot send messages or call arbitrary endpoints.');return nativeFetch(input,options);}
 let body:Record<string,unknown>={};
 if(request.headers.get('Content-Type')?.includes('application/json'))try{body=record(await request.clone().json());}catch{ /* Context still governs multipart/non-JSON requests. */ }
 const resolved=await resolve(body,scope.subject);const tenant=typeof resolved.local_tenant_id==='string'?resolved.local_tenant_id:scope.tenant;
 if(!tenant)throw new AccessError('Background work must identify its authoritative tenant before external dispatch.');
 if(scope.tenant&&tenant!==scope.tenant)throw new AccessError('Dispatch tenant differs from its source.');
 await rpc('ds_runtime_assert',{p_tenant:tenant});
 return nativeFetch(input,options);
}
// Explicitly called by physical messaging transports, not arbitrary HTTP APIs.
// Credentials can only leave for a server-configured, instance-pinned origin.
export async function messagingFetch(input:RequestInfo|URL,options?:RequestInit):Promise<Response>{
 const scope=contexts.getStore();if(!enabled())return nativeFetch(input,options);
 if(!scope)throw new AccessError('Messaging has no verified product request context.');
 let request=new Request(input,options),url=new URL(request.url),queuedAt=scope.queuedAt;
 let body:Record<string,unknown>={};if(request.headers.get('Content-Type')?.includes('application/json'))body=record(await request.clone().json());
 if(scope.product==='workforce'){
  const verified=await verifyNotificationContext(body,async(table,id)=>{const result=await localClient().from(table).select('*').eq('id',id).maybeSingle();if(result.error)throw new AccessError('Notification ownership could not be verified.');return result.data;},env('WHATSAPP_API_URL')||request.url);
  body=verified.body;queuedAt=verified.created;url=new URL(verified.endpoint);
  request=new Request(url,{method:request.method,headers:request.headers,body:JSON.stringify(body)});
 }
 const state=await resolve(body,scope.subject);const tenant=typeof state.local_tenant_id==='string'?state.local_tenant_id:scope.tenant;
 if(!tenant||scope.tenant&&scope.tenant!==tenant)throw new AccessError('Messaging tenant could not be verified.');
 const purposes={opd:'opd.reminders',growth:'growth.review_requests',workforce:'workforce.notifications',whatsapp:'whatsapp.campaigns'};
 const data=await rpc('ds_runtime_dispatch',{p_tenant:tenant,p_purpose:purposes[scope.product],p_created:queuedAt||null});
 if(data===null)return runtimeFetch(request); // explicitly grandfathered tenant only
 const route=record(data),targets=record(JSON.parse(requiredRuntimeEnv('SUITE_MESSAGING_BACKENDS'))),target=record(targets[url.origin]);
 if(url.protocol!=='https:'||url.username||url.password||target.instance_id!==route.backend_instance_id||typeof target.caller_token!=='string'||target.caller_token.length<32)throw new AccessError('Messaging host is not pinned to the verified route.',503);
 const pathSender=url.pathname.match(/\/users\/([^/]+)\/whatsapp\//)?.[1];
 if(pathSender&&decodeURIComponent(pathSender)!==route.sender_user_id)throw new AccessError('Existing sender differs from the approved suite route.');
 // Notification bridges must explicitly implement the same private headers.
 if(!pathSender&&target.notification_bridge!==true)throw new AccessError('This messaging endpoint needs a verified notification bridge.',503);
 const headers=new Headers(request.headers);headers.set('X-Suite-Product-Token',target.caller_token);
 headers.set('X-Suite-Product',scope.product);headers.set('X-Suite-Organization',String(route.organization_id));headers.set('X-Suite-Route',String(route.id));headers.set('X-Suite-Route-Version',String(route.version));headers.set('X-Suite-Purpose',String(route.purpose));
 if(queuedAt)headers.set('X-Suite-Queued-At',queuedAt);
 return nativeFetch(new Request(request,{headers,redirect:'error',signal:AbortSignal.timeout(20000)}));
}
// Keep each application's original SDK version and public types. Only its fetch
// transport is wrapped, so server REST calls use the actual user's RLS context.
export function withSuiteClient<T extends(...args:any[])=>any>(factory:T):T{
 return((...args:Parameters<T>)=>{
  const old=args[2]||{},global=old.global||{};
  args[2]={...old,global:{...global,fetch:runtimeFetch}};
  return factory(...args);
 })as T;
}
