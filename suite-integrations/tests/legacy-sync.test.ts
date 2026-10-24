import {ensureLegacyUsers} from '../runtime/legacy-sync.ts';
const assert=(condition:unknown,message='Assertion failed')=>{if(!condition)throw Error(message);};
const ids=Array.from({length:24},(_,n)=>({local_user_id:'user-'+n,local_auth_id:'auth-'+n}));
const config={url:'https://source.invalid/.netlify/functions/sync-user-to-whatsapp-db',token:'test-only-token-at-least-thirty-two-characters'};
Deno.test('legacy sync bounds concurrency and resumes acknowledged identities after a partial failure',async()=>{
 const complete=new Set<string>(),calls=new Map<string,number>();let active=0,peak=0,fail=true;
 const checkpoint=async(identity:{local_user_id:string},writer:string,save:boolean)=>{assert(writer===config.url);if(save)complete.add(identity.local_user_id);return complete.has(identity.local_user_id);};
 const transport:typeof fetch=async(_url,init)=>{
  const {id}=JSON.parse(String((init as {body?:unknown})?.body));calls.set(id,(calls.get(id)||0)+1);active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,1));active--;
  return id==='user-2'&&fail?new Response('retry',{status:503}):Response.json({success:true});
 };
 let rejected=false;try{await ensureLegacyUsers('opd',ids,{...config,checkpoint},transport);}catch{rejected=true;}
 assert(rejected&&complete.size>0&&complete.size<ids.length);assert(active===0&&peak<=4);
 const completedBefore=new Set(complete);fail=false;await ensureLegacyUsers('opd',ids,{...config,checkpoint},transport);
 assert(complete.size===ids.length&&active===0&&peak<=4);
 for(const id of completedBefore)assert(calls.get(id)===1,'Completed identity was sent again');
 await ensureLegacyUsers('opd',ids,{...config,checkpoint},transport);
 assert(calls.get('user-2')===2);
});
Deno.test('invalid identities are rejected before any writer call; lost acknowledgements remain retryable',async()=>{
 let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({success:false});};
 let rejected=false;try{await ensureLegacyUsers('opd',[ids[0],{local_user_id:'missing-auth'}],config,transport);}catch{rejected=true;}
 assert(rejected&&sends===0);
 let checkpoints=0;rejected=false;
 try{await ensureLegacyUsers('opd',[ids[0]],{...config,checkpoint:async(_id,_url,save)=>{if(save)checkpoints++;return false;}},transport);}catch{rejected=true;}
 assert(rejected&&Number(sends)===1&&checkpoints===0);
});
