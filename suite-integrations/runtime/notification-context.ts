import{AccessError,record}from'./access-core.ts';
export type NotificationLookup=(table:'notifications'|'users'|'organizations',id:string)=>Promise<Record<string,unknown>|null>;
const phone=(value:unknown)=>String(value||'').replace(/[\s()+-]/g,'').replace(/^0+(?=\d)/,'');
export async function verifyNotificationContext(input:Record<string,unknown>,find:NotificationLookup,fallback?:string){
 const body={...input};let created:string|undefined,tenant=typeof body.organizationId==='string'?body.organizationId:undefined;
 if(body.notificationId){
  if(typeof body.notificationId!=='string')throw new AccessError('Invalid notification ID.',400);
  const notification=await find('notifications',body.notificationId);
  if(!notification||typeof notification.user_id!=='string')throw new AccessError('Notification recipient could not be verified.');
  const user=await find('users',notification.user_id);
  if(!user||user.is_active===false||typeof user.organization_id!=='string')throw new AccessError('Notification recipient is inactive or has no organisation.');
  if(tenant&&tenant!==user.organization_id||body.userId&&body.userId!==notification.user_id)throw new AccessError('Notification recipient or organisation does not match its stored record.');
  tenant=user.organization_id;body.organizationId=tenant;body.userId=notification.user_id;
  created=typeof notification.created_at==='string'?notification.created_at:undefined;
  if(!created||!Number.isFinite(Date.parse(created))||Date.parse(created)>Date.now())throw new AccessError('Notification creation time is invalid.');
  // Queue data cannot be redirected to a caller-supplied phone number.
  if(notification.whatsapp_number){const stored=phone(notification.whatsapp_number),requested=phone(body.phoneNumber);if(stored!==requested&&'91'+stored!==requested&&stored!=='91'+requested)throw new AccessError('Notification destination differs from its stored recipient.');}
 }
 if(!tenant)throw new AccessError('Notification organisation is required.');
 const org=await find('organizations',tenant);if(!org||org.whatsapp_enabled!==true)throw new AccessError('WhatsApp is disabled for this organisation.');
 const endpoint=org.whatsapp_api_endpoint||org.whatsapp_endpoint||fallback;
 if(typeof endpoint!=='string'||!endpoint)throw new AccessError('Notification endpoint is not configured.',503);
 let url:URL;try{url=new URL(endpoint);}catch{throw new AccessError('Notification endpoint is invalid.',503);}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new AccessError('Notification endpoint must be a configured HTTPS service.',503);
 return{body,tenant,created,endpoint:url.toString()};
}
