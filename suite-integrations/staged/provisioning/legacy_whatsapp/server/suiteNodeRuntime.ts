import {AsyncLocalStorage} from 'node:async_hooks';
import type {Express,Request} from 'express';
import {sql} from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {db} from './db';
import {AccessError,handleAdapter,record,sameSecret,uuid,type Product} from './suiteAccessCore';
import {applyNodeSnapshot,checkNodeUser,type NodeScope,type NodeQuery} from './suiteNodeStore';
import {nodeSchema} from './suiteNodeSchema';

const modern=false;
const scopes=new AsyncLocalStorage<NodeScope>();
const enabled=()=>process.env.SUITE_RUNTIME_ENABLED==='true';
export const withSuiteScope=<T>(scope:NodeScope,work:()=>T):T=>scopes.run(scope,work);
export const suiteQuery:NodeQuery=async(text,params=[])=>{
 // Parameters remain SQL parameters for both postgres-js and Neon HTTP drivers.
 const query=sql.empty();let end=0;
 for(const match of Array.from(text.matchAll(/\$(\d+)/g))){query.append(sql.raw(text.slice(end,match.index)));query.append(sql`${params[Number(match[1])-1]}`);end=match.index!+match[0].length;}
 query.append(sql.raw(text.slice(end)));
 const result:any=await db.execute(query);return Array.isArray(result)?result:result.rows;
};
export async function initializeSuiteRuntime(){
 if(!enabled())return;
 if(modern&&(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32))throw new Error('Suite requires an explicit strong JWT_SECRET.');
 if(!process.env.SUITE_INSTANCE_ID)throw new Error('Suite instance identity is missing.');
 uuid(process.env.SUITE_INSTANCE_ID);
 for(const statement of nodeSchema.split('-- ds-statement'))await suiteQuery(statement);
}
export async function authorizeSuiteUser<T extends{userId:string;username:string;organizationId:string;role:string}>(payload:T):Promise<T>{
 if(!enabled())return payload;
 const rows=await suiteQuery('SELECT id,username,organization_id,role FROM users WHERE id::text=$1',[payload.userId]);
 const user=rows[0];if(!user)throw new AccessError('Account is unavailable.');
 const state=await checkNodeUser(suiteQuery,payload.userId,{product:'whatsapp'});
 const role=state?(state.role==='owner'||state.role==='admin'?'admin':'user'):String(user.role);
 return{...payload,userId:String(user.id),username:String(user.username),organizationId:String(user.organization_id),role};
}
export async function assertSuiteSend(userId:string,session='default'){
 if(!enabled())return;
 const context=scopes.getStore();
 const scope={...(context||{product:modern?'whatsapp':'opd',trustedCaller:modern} as NodeScope),instance:process.env.SUITE_INSTANCE_ID};
 const state=await checkNodeUser(suiteQuery,userId,scope,true,session);
 if(state&&scope.trustedCaller!==true)throw new AccessError('This enrolled sender requires authenticated product authority.');
}
export async function assertSuiteActivity(userId:string|undefined,product:Product='whatsapp'){
 if(!enabled())return;
 if(!userId)throw new AccessError('Automated work must identify its account owner.');
 await checkNodeUser(suiteQuery,userId,{product});
}
export async function assertSuiteProxy(userId:string){
 if(!enabled())return;
 const enrolled=await suiteQuery('SELECT 1 FROM ds_node_members WHERE backend_user_id=$1 LIMIT 1',[userId]);
 // The legacy shared-key proxy has no verified upstream account/session receipt.
 // Do not transfer Suite authority or phone operations through that fallback.
 if(enrolled.length)throw new AccessError('This external proxy requires verified upstream Suite integration before enrolled accounts can use it.');
 await checkNodeUser(suiteQuery,userId,{product:modern?'whatsapp':'opd'});
}
export async function assertSuiteLegacySession(sessionId:string){
 if(!enabled())return;
 const rows=await suiteQuery('SELECT user_id FROM whatsapp_sessions WHERE id::text=$1 OR session_id::text=$1',[sessionId]);
 if(rows.length!==1)throw new AccessError('Session owner could not be verified.');
 await assertSuiteSend(String(rows[0].user_id));
}
export function protectSuiteSocket(socket:any){
 if(!enabled())return;
 const timer=setInterval(()=>{void authorizeSuiteUser(socket.auth).then(auth=>{socket.auth=auth;}).catch(()=>socket.close(1008,'Product access inactive'));},15000);
 timer.unref?.();socket.once('close',()=>clearInterval(timer));
}
export async function deliverSuiteFrame(socket:any,message:string,owner?:string,ownerOrg?:string){
 try{
  if(socket.readyState!==socket.OPEN||!socket.auth)return;
  const auth=await authorizeSuiteUser(socket.auth);socket.auth=auth;
  if(auth.role!=='super_admin'&&auth.userId!==owner&&(!ownerOrg||auth.organizationId!==ownerOrg))return;
  if(socket.readyState===socket.OPEN)socket.send(message);
 }catch{socket.close(1008,'Product access inactive');}
}
export async function suiteNotificationSender(localTenant:string){
 if(!enabled())return null;
 const rows=await suiteQuery("SELECT organization_id,snapshot FROM ds_node_bindings WHERE product_code='workforce' AND local_tenant_id=$1",[localTenant]);
 if(!rows.length)return null;
 const scope=scopes.getStore();if(!scope||scope.product!=='workforce'||scope.trustedCaller!==true||scope.organization!==String(rows[0].organization_id))throw new AccessError('Notification caller is outside the verified organisation.');
 const routes=record(rows[0].snapshot).messaging_routes;
 const route=Array.isArray(routes)?routes.map(record).find(r=>r.id===scope.route&&r.purpose==='workforce.notifications'):null;
 if(!route||typeof route.sender_user_id!=='string'||typeof route.session_name!=='string')throw new AccessError('Notification route is unavailable.');
 await checkNodeUser(suiteQuery,route.sender_user_id,{...scope,instance:process.env.SUITE_INSTANCE_ID},true,route.session_name);
 return{userId:route.sender_user_id,sessionName:route.session_name};
}
export async function authorizeWorkforceBridge<T extends{organizationId:string;userId:string;sessionName:string;action:string;admins:{id:string}[]}>(input:T):Promise<T>{
 if(!enabled())return input;
 const bindings=await suiteQuery("SELECT organization_id FROM ds_node_bindings WHERE product_code='workforce' AND local_tenant_id=$1",[input.organizationId]);
 if(!bindings.length){
  const enrolled=await suiteQuery('SELECT 1 FROM ds_node_members WHERE backend_user_id IN(SELECT jsonb_array_elements_text($1::jsonb)) OR source_user_id IN(SELECT jsonb_array_elements_text($1::jsonb)) LIMIT 1',[JSON.stringify(input.admins.map(a=>a.id))]);
  if(enrolled.length)throw new AccessError('Workforce organisation does not match enrolled accounts.');
  return input;
 }
 const organization=String(bindings[0].organization_id),admins:T['admins']=[];let backendTenant:string|undefined;
 for(const admin of input.admins){
  const matches=await suiteQuery("SELECT m.backend_user_id,u.organization_id FROM ds_node_members m JOIN users u ON u.id::text=m.backend_user_id WHERE m.organization_id=$1 AND m.product_code='workforce' AND m.source_user_id=$2 AND m.active AND m.role IN('owner','admin')",[organization,admin.id]);
  if(matches.length!==1)throw new AccessError('Workforce administrator is outside approved Suite membership.');
  const user=matches[0];
  await checkNodeUser(suiteQuery,String(user.backend_user_id),{product:'workforce',organization});
  if(backendTenant&&backendTenant!==String(user.organization_id))throw new AccessError('Workforce backend tenant is inconsistent.');
  backendTenant=String(user.organization_id);admins.push({...admin,id:String(user.backend_user_id)});
 }
 const index=input.admins.findIndex(a=>a.id===input.userId);if(index<0||!backendTenant)throw new AccessError('Workforce administrator is unavailable.');
 const userId=admins[index].id;
 if(!['sync_admins','handshake'].includes(input.action))await checkNodeUser(suiteQuery,userId,{product:'workforce',organization,purpose:'workforce.notifications',instance:process.env.SUITE_INSTANCE_ID},true,input.sessionName);
 return{...input,organizationId:backendTenant,userId,admins};
}
function scopedSession<T extends object>(service:T,product:Product,purpose:string):T{
 return new Proxy(service,{get(target,key,receiver){
  const value=Reflect.get(target,key,receiver);
  if(typeof value!=='function')return value;
  if(typeof key==='string'&&key.startsWith('send'))return(...args:unknown[])=>withSuiteScope({product,purpose,trustedCaller:true},()=>value.apply(target,args));
  return value.bind(target);
 }});
}
export const workforceSession=<T extends object>(service:T)=>scopedSession(service,'workforce','workforce.hr_bot');
export const whatsappSession=<T extends object>(service:T)=>scopedSession(service,'whatsapp','whatsapp.campaigns');
function tenantAliases(state:Record<string,any>,backendTenant:string):string[]{
 const bindings=record(state.snapshot).bindings;
 return[backendTenant,...Array.isArray(bindings)?bindings.map(record).map(b=>b.local_tenant_id).filter((id):id is string=>typeof id==='string'):[]];
}
async function enforceSuiteRequest(req:Request,auth:{userId:string;organizationId:string;role:string}){
 const state=await checkNodeUser(suiteQuery,auth.userId,{product:'whatsapp'});if(!state)return;
 const aliases=tenantAliases(state,auth.organizationId);
 if(['/api/hr-chatbot/config','/api/opd-settings'].includes(req.path))throw new AccessError('Shared backend configuration is managed by the platform administrator.');
 for(const value of [req.body?.organizationId,req.body?.organization_id,req.query.organizationId,req.headers['x-organization-id']])if(value&&!aliases.includes(String(value)))throw new AccessError('Request organisation differs from the verified suite bindings.');
 const sourceUser=req.body?.userId||req.query.userId||req.headers['x-user-id'];
 if(sourceUser&&sourceUser!==auth.userId){
  const matches=await suiteQuery('SELECT role FROM ds_node_members WHERE organization_id=$1 AND active AND (backend_user_id=$2 OR source_user_id=$2)',[state.organization_id,String(sourceUser)]);
  if(!matches.length||state.role==='member')throw new AccessError('Requested user is outside your permitted organisation scope.');
 }
 const phonePath=req.path.match(/^\/api\/(hims-patients|hr-admins)\/([^/]+)(?:\/|$)/);
 if(phonePath){
  const table=phonePath[1]==='hims-patients'?'hims_patients':'hr_admins';
  const matches=await suiteQuery(`SELECT organization_id FROM ${table} WHERE phone_number=$1`,[decodeURIComponent(phonePath[2])]);
  if(matches.length!==1||!aliases.includes(String(matches[0].organization_id)))throw new AccessError('This record belongs to another organisation.');
 }
 if(['/api/hims-patients','/api/hr-admins'].includes(req.path)&&req.method==='GET'&&!req.query.organizationId){
  const product=req.path==='/api/hims-patients'?'opd':'workforce';
  const bindings=record(state.snapshot).bindings;
  const binding=Array.isArray(bindings)?bindings.map(record).find(b=>b.product_code===product):null;
  req.query.organizationId=typeof binding?.local_tenant_id==='string'?binding.local_tenant_id:auth.organizationId;
 }
}
export async function assertSuitePatientOwner(userId:string|undefined,phone:string){
 if(!enabled())return;if(!userId)throw new AccessError('Patient automation requires an account owner.');
 const state=await checkNodeUser(suiteQuery,userId,{product:'whatsapp'});if(!state)return;
 const users=await suiteQuery('SELECT organization_id FROM users WHERE id::text=$1',[userId]);
 const patients=await suiteQuery('SELECT organization_id FROM hims_patients WHERE phone_number=$1',[phone]);
 if(patients.length!==1||!tenantAliases(state,String(users[0]?.organization_id)).includes(String(patients[0].organization_id)))throw new AccessError('Patient organisation differs from its session owner.');
}
const requestHeaders=(req:Request)=>{const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);return headers;};
const asRequest=(req:Request)=>new Request('https://suite.internal'+req.path,{method:'POST',headers:requestHeaders(req),body:JSON.stringify(req.body)});
export function registerSuiteRuntime(app:Express){
 app.post('/api/suite/adapter',async(req,res)=>{
  if(!modern||!enabled()){res.status(503).json({error:'Product runtime unavailable.'});return;}
  const response=await handleAdapter(asRequest(req),{product:'whatsapp',token:process.env.SUITE_ADAPTER_TOKEN,instance:process.env.SUITE_INSTANCE_ID,environment:process.env.SUITE_ENVIRONMENT},{async apply(snapshot){
   const result=await applyNodeSnapshot(suiteQuery,secret=>bcrypt.hash(secret,12),snapshot,true);
   return{local_tenant_id:String(result.local_tenant_id),version:Number(result.version),identities:result.identities,enforcement:{server:false,workers:false,expires_at:true,tenant_isolation:false}};
  }});res.status(response.status).set('Cache-Control','no-store').type('json').send(await response.text());
 });
 app.post('/api/suite/dependency',async(req,res)=>{
  const product=req.body?.product_code as Product;
  if(!enabled()||!(modern?['workforce']:['opd','growth']).includes(product)){res.status(503).json({error:'Dependency unavailable.'});return;}
  const response=await handleAdapter(asRequest(req),{product,token:process.env[`SUITE_${product.toUpperCase()}_DEPENDENCY_TOKEN`],instance:process.env.SUITE_INSTANCE_ID,environment:process.env.SUITE_ENVIRONMENT},{async apply(snapshot){
   const result=await applyNodeSnapshot(suiteQuery,secret=>bcrypt.hash(secret,12),snapshot,modern,true);
   return{local_tenant_id:String(result.local_tenant_id),version:Number(result.version),identities:result.identities,enforcement:{server:false,workers:false,expires_at:true,tenant_isolation:false}};
  }});res.status(response.status).set('Cache-Control','no-store').type('json').send(await response.text());
 });
 app.post('/api/suite/entry',async(req,res)=>{
  try{
   if(!modern||!enabled())throw new AccessError('Suite login unavailable.',503);
   const origins=(process.env.SUITE_PRODUCT_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
   if(req.headers.origin&&!origins.includes(req.headers.origin))throw new AccessError('Origin is not allowed.');
   const ticket=req.body?.ticket;if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))throw new AccessError('Invalid login link.');
   const token=process.env.SUITE_ACCESS_TOKEN,url=new URL(process.env.SUITE_ACCESS_URL||'');
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!token||token.length<32)throw new AccessError('Product login configuration is invalid.',503);
   const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'redeem_launch',ticket,instance_id:uuid(process.env.SUITE_INSTANCE_ID)})});
   if(!response.ok)throw new AccessError('Login link expired or access is inactive.');
   const identity=record(await response.json());if(identity.product_code!=='whatsapp'||typeof identity.local_user_id!=='string')throw new AccessError('Product identity mismatch.');
   const state=await checkNodeUser(suiteQuery,identity.local_user_id,{product:'whatsapp'});
   if(!state||state.local_tenant_id!==identity.local_tenant_id)throw new AccessError('Product account is not ready.');
   const rows=await suiteQuery('SELECT id,username,email,organization_id,role FROM users WHERE id::text=$1',[identity.local_user_id]);
   if(!rows[0])throw new AccessError('Product account unavailable.');const source=rows[0];
   const payload=await authorizeSuiteUser({userId:String(source.id),username:String(source.username),organizationId:String(source.organization_id),role:String(source.role)});
   const secret=process.env.JWT_SECRET;if(!secret||secret.length<32)throw new AccessError('Product login is not configured.',503);
   res.set('Cache-Control','no-store').json({user:{id:payload.userId,username:payload.username,email:source.email,organizationId:payload.organizationId,role:payload.role},token:jwt.sign(payload,secret,{expiresIn:'1h'})});
  }catch(e){res.status(e instanceof AccessError?e.status:503).set('Cache-Control','no-store').json({error:e instanceof AccessError?e.message:'Product login unavailable.'});}
 });
 app.use(async(req,res,next)=>{
  if(!enabled()){next();return;}
  try{
   const product=req.headers['x-suite-product'] as Product|undefined;
   if(product){
    if(!(modern?['whatsapp','workforce']:['opd','growth']).includes(product)||req.headers.origin)throw new AccessError('Invalid originating product.');
    const actual=req.headers['x-suite-product-token'],expected=process.env[`SUITE_${product.toUpperCase()}_CALLER_TOKEN`];
    if(typeof actual!=='string'||actual.length>512||!expected||expected.length<32||!await sameSecret(actual,expected))throw new AccessError('Invalid product caller.',401);
    const scope:NodeScope={product,trustedCaller:true,organization:uuid(req.headers['x-suite-organization']),route:uuid(req.headers['x-suite-route']),routeVersion:Number(req.headers['x-suite-route-version']),purpose:String(req.headers['x-suite-purpose']),queuedAt:req.headers['x-suite-queued-at'] as string|undefined};
    if(!Number.isSafeInteger(scope.routeVersion)||scope.routeVersion!<1)throw new AccessError('Invalid route version.');
    // A product credential cannot use global management/listing APIs.
    const owner=req.path.match(/^\/api\/users\/([^/]+)\/whatsapp(?:\/|$)/)?.[1];
    if(owner){await checkNodeUser(suiteQuery,decodeURIComponent(owner),scope,true,String(req.body?.sessionName||'default'));}
    else if(!(modern&&product==='workforce'&&['/api/send-notification','/api/send-notifications-batch'].includes(req.path)))throw new AccessError('This route is outside the product caller scope.');
    scopes.run(scope,()=>next());return;
   }
   if(req.path==='/api/auth/register')throw new AccessError('Ask your administrator to create your account in Doctor Suite.');
   const bearer=req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
   // Existing Workforce bridge verifies its own fixed source and exact admin list.
   if(modern&&req.path==='/api/integrations/workforce'){
    const expected=process.env.WORKFORCE_INTEGRATION_TOKEN;
    if(!bearer||!expected||expected.length<32||!await sameSecret(bearer,expected))throw new AccessError('Invalid Workforce caller.',401);
    scopes.run({product:'workforce',trustedCaller:true},()=>next());return;
   }
   if(modern&&bearer&&process.env.JWT_SECRET){
    const raw=record(jwt.verify(bearer,process.env.JWT_SECRET));
    const auth=await authorizeSuiteUser({userId:String(raw.userId),username:String(raw.username),organizationId:String(raw.organizationId),role:String(raw.role)});
    await enforceSuiteRequest(req,auth);
    (req as any).auth=auth;scopes.run({product:'whatsapp',trustedCaller:true},()=>next());return;
   }
   // Meta's handler verifies the raw-body signature before loading its session.
   if(req.path.startsWith('/api/')&&!['/api/auth/login','/api/health','/api/external/health','/api/webhooks/meta'].includes(req.path)){
    const owner=req.path.match(/^\/api\/(?:external\/)?users\/([^/]+)(?:\/|$)/)?.[1];
    if(owner){const found=await suiteQuery('SELECT 1 FROM ds_node_members WHERE backend_user_id=$1 LIMIT 1',[decodeURIComponent(owner)]);if(found.length)throw new AccessError('Enrolled accounts require authenticated product authority.');}
    else{const found=await suiteQuery('SELECT 1 FROM ds_node_bindings LIMIT 1');if(found.length)throw new AccessError('This unscoped endpoint requires a product-specific integration.');}
   }
   // API-key callers do not automatically acquire authority over enrolled users.
   scopes.run({product:modern?'whatsapp':'opd',trustedCaller:false},()=>next());
  }catch(e){res.status(e instanceof AccessError?e.status:503).json({error:'Product authority could not be verified.'});}
 });
}
