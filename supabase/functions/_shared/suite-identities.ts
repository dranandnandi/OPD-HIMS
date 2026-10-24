import { inspectConnection } from './suite-connections.ts';
import { object, SuiteError } from './suite-contract.ts';
import type { SuiteRpc } from './suite-delivery.ts';
import type { Component } from './suite-connector-core.ts';
export async function linkProductIdentity(rpc:SuiteRpc,actor:string,request:string,input:Record<string,unknown>){
 const receipt=await rpc('suite_operation_receipt',{p_actor:actor,p_request:request,p_action:'link_product_identity',p_input:input});if(receipt)return receipt;
 const detail=object(await rpc('suite_detail',{p_id:input.organization_id}));
 const binding=Array.isArray(detail.bindings)?detail.bindings.map(object).find(b=>b.product_code===input.product_code):undefined;
 if(!binding?.local_tenant_id)throw new SuiteError('Link the product tenant before approving its login.',409);
 const checked=await inspectConnection(input.product_code as Component,String(input.local_user_id));
 const identity=object(checked.identity);
 if(identity.local_user_id!==input.local_user_id||identity.local_tenant_id!==binding.local_tenant_id)throw new SuiteError('Product user does not belong to the linked tenant.',409);
 await rpc('suite_record_connection',{p_component:input.product_code,p_instance:checked.instance_id,p_environment:checked.environment,p_actor:actor});
 return rpc('suite_link_product_identity',{p_actor:actor,p_request:request,p_payload:{...input,command:input,
  local_tenant_id:binding.local_tenant_id,binding_version:binding.version,local_auth_id:identity.local_auth_id,instance_id:checked.instance_id}});
}
