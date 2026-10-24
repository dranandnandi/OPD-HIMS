import {Pool} from 'pg';
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
