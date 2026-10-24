import{verifyNotificationContext}from'../runtime/notification-context.ts';
function assert(v:unknown):asserts v{if(!v)throw Error('Assertion failed');}
Deno.test('Task dispatch derives queue age, recipient and organisation-specific endpoint from stored rows',async()=>{
 const created=new Date(Date.now()-1000).toISOString();
 const rows:Record<string,Record<string,unknown>>={notifications:{id:'notification',user_id:'user',created_at:created,whatsapp_number:'9876543210'},users:{id:'user',organization_id:'org',is_active:true},organizations:{id:'org',whatsapp_enabled:true,whatsapp_api_endpoint:'https://verified.invalid/api/send-notification'}};
 const find=async(table:string,id:string)=>rows[table]?.id===id?rows[table]:null;
 const body={notificationId:'notification',phoneNumber:'919876543210',organizationId:'org',userId:'user',created_at:'2020-01-01'};
 const result=await verifyNotificationContext(body,find,'https://default.invalid');assert(result.created===created);assert(result.endpoint==='https://verified.invalid/api/send-notification');assert(result.body.userId==='user');
 for(const patch of [{organizationId:'other'},{userId:'other'},{phoneNumber:'1111111111'},{notificationId:'missing'}]){let rejected=false;try{await verifyNotificationContext({...body,...patch},find);}catch{rejected=true;}assert(rejected);}
 rows.users.is_active=false;let rejected=false;try{await verifyNotificationContext(body,find);}catch{rejected=true;}assert(rejected);
});
Deno.test('disabled organisations, missing/invalid endpoints and future queue times are rejected',async()=>{
 const find=async(table:string)=>table==='organizations'?{id:'org',whatsapp_enabled:false}:null;
 let rejected=false;try{await verifyNotificationContext({organizationId:'org'},find,'https://default.invalid');}catch{rejected=true;}assert(rejected);
 for(const endpoint of ['http://insecure.invalid','https://user:password@host.invalid','https://host.invalid?token=x']){
  rejected=false;try{await verifyNotificationContext({organizationId:'org'},async()=>({whatsapp_enabled:true,whatsapp_api_endpoint:endpoint}));}catch{rejected=true;}assert(rejected);
 }
 rejected=false;try{await verifyNotificationContext({notificationId:'n'},async table=>table==='notifications'?{user_id:'u',created_at:new Date(Date.now()+60000).toISOString()}:table==='users'?{organization_id:'org'}:{whatsapp_enabled:true,whatsapp_api_endpoint:'https://host.invalid'});}catch{rejected=true;}assert(rejected);
});
