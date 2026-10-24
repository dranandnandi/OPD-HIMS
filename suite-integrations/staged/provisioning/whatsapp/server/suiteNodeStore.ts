import{AccessError,activeMembers,record,type Snapshot,type Product}from'./suiteAccessCore';
export type NodeQuery=(text:string,params?:unknown[])=>Promise<Record<string,any>[]>;
export type NodeScope={product:Product;organization?:string;route?:string;routeVersion?:number;purpose?:string;queuedAt?:string;trustedCaller?:boolean;instance?:string};
export async function applyNodeSnapshot(query:NodeQuery,hash:(secret:string)=>Promise<string>,snapshot:Snapshot,modern:boolean,dependency=false){
 const members=activeMembers(snapshot),links:Record<string,unknown>[]=[];
 let tenant=snapshot.local_tenant_id||snapshot.organization_id;
 let backendTenant=tenant;
 const task=snapshot.bindings?.find(b=>b.product_code==='workforce');
 const shareTask=modern&&snapshot.product_code==='whatsapp'&&!snapshot.local_tenant_id&&task;
 if(shareTask){if(task.state!=='ready'||!task.local_tenant_id)throw new AccessError('Workforce must finish provisioning its shared messaging identities first.',409);tenant=task.local_tenant_id;backendTenant=tenant;}
 for(const member of [...members].sort((a,b)=>a.id.localeCompare(b.id))){
  const approved=snapshot.identity_links?.find(i=>i.member_id===member.id);
  const source=dependency?(snapshot as Snapshot&{provisioned_identities?:Snapshot['identity_links']}).provisioned_identities?.find(i=>i.member_id===member.id):approved;
  let backendId=approved?.local_user_id||member.id;
  if(shareTask){const taskIdentity=snapshot.product_links?.find(i=>i.product_code==='workforce'&&i.member_id===member.id);if(!taskIdentity)throw new AccessError('Shared Task identity is not linked yet.',409);backendId=taskIdentity.local_user_id;}
  else if(dependency&&modern){if(!source)throw new AccessError('Source user has not been provisioned.',409);backendId=source.local_user_id;}
  const link:Record<string,unknown>={member_id:member.id,source_user_id:source?.local_user_id||backendId,source_auth_id:source?.local_auth_id,backend_user_id:backendId};
  if(modern){
   const found=await query('SELECT id,organization_id FROM users WHERE id::text=$1',[backendId]);
   if(found[0]&&String(found[0].organization_id)!==backendTenant)throw new AccessError('Existing WhatsApp identity belongs to another organisation. Link its tenant explicitly.',409);
   if(!found.length){const secret=Array.from(crypto.getRandomValues(new Uint8Array(48)),n=>n.toString(16).padStart(2,'0')).join('');link.password_hash=await hash(secret);}
  }else if(!source?.local_auth_id)throw new AccessError('Verified source Auth mapping is required for legacy messaging.',409);
  links.push(link);
 }
 const payload={...snapshot,local_tenant_id:tenant,backend_tenant_id:backendTenant};
 const rows=await query('SELECT ds_node_apply($1::jsonb,$2::jsonb,$3::boolean) AS result',[JSON.stringify(payload),JSON.stringify(links),modern]);
 return record(rows[0]?.result);
}
export async function checkNodeUser(query:NodeQuery,userId:string,scope:NodeScope,dispatch=false,session='default'){
 const rows=await query(`SELECT m.*,b.local_tenant_id,b.snapshot,b.access_until,b.fresh_until,b.active_since FROM ds_node_members m JOIN ds_node_bindings b USING(organization_id,product_code) WHERE m.backend_user_id=$1 AND m.product_code=$2`,[userId,scope.product]);
 const row=rows[0];
 if(!row){
  const enrolled=await query('SELECT 1 AS managed FROM ds_node_members WHERE backend_user_id=$1 LIMIT 1',[userId]);
  if(enrolled.length)throw new AccessError('This messaging identity has no active permission for the originating product.');
  const legacy=await query('SELECT 1 AS allowed FROM ds_node_legacy_users WHERE user_id=$1',[userId]);
  if(!legacy.length)throw new AccessError('This messaging account needs suite enrolment.');
  return null;
 }
 const now=Date.now(),snapshot=record(row.snapshot);
 const expiry=new Date(row.access_until).getTime(),fresh=new Date(row.fresh_until).getTime();
 if(row.active!==true||record(snapshot.organization).status!=='active'||!Number.isFinite(expiry)||!Number.isFinite(fresh)||expiry<=now||fresh<=now)throw new AccessError('Product access is inactive, expired or needs synchronisation.');
 if(scope.organization&&scope.organization!==String(row.organization_id))throw new AccessError('Messaging organisation mismatch.');
 if(scope.queuedAt){const queued=Date.parse(scope.queuedAt),since=new Date(row.active_since).getTime();if(!Number.isFinite(queued)||!Number.isFinite(since)||queued<since||queued>now)throw new AccessError('Queued work predates the current activation or has an invalid timestamp.');}
 if(dispatch){
  const purposes:{[key:string]:string[]}={opd:['opd.reminders'],growth:['growth.review_requests'],workforce:['workforce.notifications','workforce.hr_bot'],whatsapp:['whatsapp.campaigns']};
  const purpose=scope.purpose||purposes[scope.product][0];
  if(!purposes[scope.product].includes(purpose))throw new AccessError('Messaging purpose does not belong to its originating product.');
  const routes=Array.isArray(snapshot.messaging_routes)?snapshot.messaging_routes.map(record):[];
  const route=routes.find(r=>r.purpose===purpose&&r.sender_user_id===userId&&r.session_name===session);
  if(!route||route.enabled!==true)throw new AccessError('The sender/session is not an enabled suite messaging route.');
  if(scope.instance&&route.backend_instance_id!==scope.instance)throw new AccessError('Messaging route belongs to another backend instance.');
  if(scope.route&&route.id!==scope.route||scope.routeVersion&&route.version!==scope.routeVersion)throw new AccessError('Messaging route changed. Reconcile before dispatch.');
 }
 return row;
}
