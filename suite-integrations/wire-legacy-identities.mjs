import fs from 'node:fs';import path from 'node:path';
import {editPackage,folder} from './package-edit.mjs';
const pkg=editPackage(),core=fs.readFileSync(path.join(folder,'runtime/legacy-identity.ts'),'utf8');
for(const product of ['opd','growth'])pkg.put(product,'netlify/functions/_shared/suite-legacy-identity.ts',core);
pkg.put('opd','netlify/functions/sync-user-to-whatsapp-db.ts',`import type {Handler} from '@netlify/functions';
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
`);
pkg.put('growth','netlify/functions/_shared/userLookup.ts',`import {Pool} from 'pg';
import {ensureLegacyIdentity} from './suite-legacy-identity';
const pool=new Pool({connectionString:process.env.WHATSAPP_DB_CONNECTION_STRING,ssl:{rejectUnauthorized:false}});
type EnsureUserOptions={authId?:string;username?:string;role?:string};
export async function getUserIdFromAuthId(authId:string):Promise<string|null>{
 const result=await pool.query('SELECT id FROM users WHERE auth_id::text=$1',[authId]);
 if(result.rows.length>1)throw new Error('Legacy Auth identity is ambiguous.');
 return result.rows[0]?.id||null;
}
export async function ensureUserExists(userId:string,email?:string,fullName?:string,options?:EnsureUserOptions):Promise<string>{
 const connection=await pool.connect();
 try{const row=await ensureLegacyIdentity(connection,{preferredId:userId,authId:options?.authId||userId,username:options?.username||email||'suite-'+userId,name:fullName||email||'Suite member'});return String(row.id);}
 finally{connection.release();}
}
`);
pkg.save();console.log('Staged exact Auth identity reconciliation for both legacy writers.');
