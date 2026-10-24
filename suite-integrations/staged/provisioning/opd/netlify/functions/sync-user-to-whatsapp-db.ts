import type {Handler} from '@netlify/functions';
import {Pool} from 'pg';
import {guardNetlify,requiredRuntimeEnv} from './_shared/suite-runtime-guard';
import {corsHeaders,ok,error} from './_shared/whatsappClient';
import {ensureLegacyIdentity} from './_shared/suite-legacy-identity';
const handler:Handler=guardNetlify(async event=>{
 if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:corsHeaders,body:''};
 if(event.httpMethod!=='POST')return error('Use POST.',405);
 const pool=new Pool({connectionString:requiredRuntimeEnv('WHATSAPP_DB_CONNECTION_STRING'),ssl:{rejectUnauthorized:false}});
 try{
  const body=JSON.parse(event.body||'{}'),connection=await pool.connect();
  try{
   const user=await ensureLegacyIdentity(connection,{authId:body.authId||body.userId,username:body.username,name:body.name,clinicName:body.clinicName,clinicAddress:body.clinicAddress,contactPhone:body.contactPhone,contactEmail:body.contactEmail,contactWhatsapp:body.contactWhatsapp});
   return ok({success:true,message:'Verified identity linked to WhatsApp backend',user});
  }finally{connection.release();}
 }catch{return error('Identity sync failed. Review the verified account mapping.',409);}
 finally{await pool.end();}
},'opd','sync-user-to-whatsapp-db');
export{handler};
