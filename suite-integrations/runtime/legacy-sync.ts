import{AccessError,record,type Product}from'./access-core.ts';
type Identity={local_user_id:string;local_auth_id:string};
type Checkpoint=(identity:Identity,writer:string,complete:boolean,signal:AbortSignal)=>Promise<boolean>;
type CheckpointClient={rpc:(name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}};
export const legacyCheckpoint=(client:CheckpointClient):Checkpoint=>async(identity,writer,complete,signal)=>{
 const result=await client.rpc('ds_legacy_sync_checkpoint',{p_user:identity.local_user_id,p_auth:identity.local_auth_id,p_writer:writer,p_complete:complete}).abortSignal(signal);
 if(result.error)throw new AccessError('Legacy identity checkpoint is unavailable.',503);
 return result.data===true;
};
// The existing source writer validates each profile against its own database.
// Await it before central delivery asks the shared backend to observe that Auth ID.
export async function ensureLegacyUsers(product:Product,identities:unknown,config:{url?:string;token?:string;checkpoint?:Checkpoint},transport:typeof fetch=fetch){
 if(!['opd','growth'].includes(product))return;
 if(!config.url||!config.token||config.token.length<32)throw new AccessError('Legacy identity writer is not configured.',503);
 const target=new URL(config.url),path=product==='opd'?'/sync-user-to-whatsapp-db':'/webhook-sync-user';
 if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||!target.pathname.endsWith('/.netlify/functions'+path))throw new AccessError('Legacy identity writer must be the configured source product webhook.',503);
 if(!Array.isArray(identities))throw new AccessError('Provisioned product identities are missing.',409);
 const members=identities.map(value=>{
  const identity=record(value);if(typeof identity.local_user_id!=='string'||typeof identity.local_auth_id!=='string')throw new AccessError('Verified product identity is missing.',409);
  return{local_user_id:identity.local_user_id,local_auth_id:identity.local_auth_id};
 });
 // Bound each attempt below central delivery's 20-second timeout. Durable
 // per-identity receipts let subsequent queue attempts resume larger clinics.
 const deadline=AbortSignal.timeout(14000);let cursor=0;let failure:unknown;
 async function worker(){while(cursor<members.length&&!failure){
  const identity=members[cursor++];
  try{
  deadline.throwIfAborted();
  if(await config.checkpoint?.(identity,target.href,false,deadline))continue;
  const response=await transport(target,{method:'POST',redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)]),headers:{'Content-Type':'application/json','x-webhook-secret':config.token!},body:JSON.stringify({id:identity.local_user_id})});
  if(!response.ok)throw new AccessError('Legacy user synchronisation did not complete. Retry after checking the source writer.',409);
  const raw=await response.text();if(raw.length>8192)throw new AccessError('Invalid identity writer response.',502);
  const result=record(JSON.parse(raw));if(result.success!==true)throw new AccessError('Legacy user synchronisation was not acknowledged.',409);
  await config.checkpoint?.(identity,target.href,true,deadline);
  }catch(error){failure=error;}
 }}
 await Promise.all(Array.from({length:Math.min(4,members.length)},()=>worker()));
 if(failure)throw failure instanceof AccessError?failure:new AccessError('Legacy identity synchronisation is incomplete; retry resumes completed identities.',409);
}
