import {object,SuiteError,uuid,validateAdapterResponse} from './suite-contract.ts';
import type {SuiteRpc} from './suite-delivery.ts';
export function dependencyConfig(product:string){
 if(!['opd','growth','workforce'].includes(product))return null;
 const component=product==='workforce'?'whatsapp':'legacy_whatsapp';
 return{component,url:Deno.env.get(`SUITE_${component.toUpperCase()}_DEPENDENCY_URL`),instance:Deno.env.get(`SUITE_${component.toUpperCase()}_INSTANCE_ID`),token:Deno.env.get(`SUITE_${product.toUpperCase()}_DEPENDENCY_TOKEN`)};
}
export function dependencyConfigured(product:string):boolean{
 const config=dependencyConfig(product);if(!config)return true;
 try{if(!config.url||!config.token||config.token.length<32||!config.instance)return false;uuid(config.instance,'dependency instance');const url=new URL(config.url);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
}
export async function deliverDependency(rpc:SuiteRpc,actor:string,job:Record<string,unknown>,tenant:string,identities:unknown,environment:string){
 const config=dependencyConfig(String(job.product_code));if(!config)return;
 if(!dependencyConfigured(String(job.product_code)))throw new SuiteError('The messaging dependency is not configured.',409);
 if(!Array.isArray(identities)||!identities.length)throw new SuiteError('The product must return verified identities before messaging provisioning.',502);
 const snapshot={...job,local_tenant_id:tenant,provisioned_identities:identities,target_instance_id:config.instance,environment};
 const response=await fetch(config.url!,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json','Idempotency-Key':String(job.job_id)},body:JSON.stringify(snapshot)});
 if(!response.ok)throw new SuiteError(`Messaging dependency rejected synchronisation (HTTP ${response.status}).`,502);
 const raw=await response.text();if(raw.length>262144)throw new SuiteError('Messaging dependency response is too large.',502);
 const result=object(JSON.parse(raw));validateAdapterResponse(result,snapshot);
 if(!Array.isArray(result.identities)||result.identities.length!==identities.length)throw new SuiteError('Messaging dependency returned an incomplete identity receipt.',502);
 const saved=await rpc('suite_note_dependency',{p_job:job.job_id,p_lease:job.lease_id,p_actor:actor,p_instance:config.instance,p_identities:result.identities});
 if(!saved)throw new SuiteError('Messaging provisioning lease changed. Retry to reconcile safely.',409);
}
