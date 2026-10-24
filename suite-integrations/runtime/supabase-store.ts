import {AccessError,activeMembers,record,type Snapshot,type Product} from './access-core.ts';
export type LocalClient={
 rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
 auth:{admin:{getUserById(id:string):PromiseLike<{data:{user:{id:string;email?:string;email_confirmed_at?:string|null}|null};error:unknown}>;
 createUser(input:{email:string;password:string;email_confirm:boolean;app_metadata:Record<string,unknown>}):PromiseLike<{data:{user:{id:string}|null};error:unknown}>}};
};
type Linked={member_id:string;local_user_id:string;local_auth_id:string|null};
export async function applySupabaseSnapshot(client:LocalClient,snapshot:Snapshot&{identity_links?:Linked[]},product:Exclude<Product,'whatsapp'>){
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await client.rpc(name,args);if(r.error)throw new AccessError('Product provisioning was rejected. Check tenant ownership, identity approvals and product migration.',409);return r.data;};
 const links:{member_id:string;local_auth_id:string;local_user_id:string}[]=[];
 for(const member of activeMembers(snapshot)){
  const approved=snapshot.identity_links?.find(link=>link.member_id===member.id);
  let authId=approved?.local_auth_id||undefined;
  if(product==='opd')authId=member.auth_user_id!;
  if(!authId){
   const existing=await rpc('ds_runtime_auth',{p_central:member.auth_user_id,p_org:snapshot.organization_id,p_email:member.email});
   if(existing){const found=record(existing);if(found.owned!==true)throw new AccessError('An existing product login needs explicit identity approval in Suite Admin.',409);authId=String(found.id);}
   else{
    const password=Array.from(crypto.getRandomValues(new Uint8Array(48)),n=>n.toString(16).padStart(2,'0')).join('');
    const result=await client.auth.admin.createUser({email:member.email,password,email_confirm:true,app_metadata:{doctor_suite:{central_user_id:member.auth_user_id,organization_id:snapshot.organization_id}}});
    if(result.error||!result.data.user){
     // A lost response or concurrent retry may have created the same owned login.
     const retry=await rpc('ds_runtime_auth',{p_central:member.auth_user_id,p_org:snapshot.organization_id,p_email:member.email});
     if(!retry||record(retry).owned!==true)throw new AccessError('Product login could not be created. Reconcile any existing account before retrying.',409);
     authId=String(record(retry).id);
    }else authId=result.data.user.id;
   }
  }
  const actual=await client.auth.admin.getUserById(authId);
  if(actual.error||!actual.data.user?.email_confirmed_at)throw new AccessError('The approved product login is not verified.',409);
  links.push({member_id:member.id,local_auth_id:authId,local_user_id:approved?.local_user_id||(product==='opd'?authId:member.id)});
 }
 return record(await rpc('ds_runtime_apply',{p_snapshot:snapshot,p_links:links}));
}
