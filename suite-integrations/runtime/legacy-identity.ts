// Called only after the source product verifies the public profile and Auth ID.
// Both OPD and Growth take the same transaction lock in their shared backend.
type Connection={query:(text:string,values?:unknown[])=>Promise<{rows:Record<string,any>[]}>};
export type LegacyProfile={authId:string;preferredId?:string;username:string;name:string;clinicName?:string;clinicAddress?:string;contactPhone?:string;contactEmail?:string;contactWhatsapp?:string};
export async function ensureLegacyIdentity(connection:Connection,profile:LegacyProfile){
 const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 if(!uuid.test(profile.authId)||profile.preferredId&&!uuid.test(profile.preferredId))throw new Error('Verified source identity is required.');
 if(!profile.username?.trim()||!profile.name?.trim())throw new Error('Verified profile name and username are required.');
 await connection.query('BEGIN');
 try{
  await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('legacy-auth:'||$1,0))",[profile.authId]);
  const existing=await connection.query('SELECT id,auth_id,username,name,role FROM users WHERE auth_id::text=$1 FOR UPDATE',[profile.authId]);
  if(existing.rows.length>1)throw new Error('Legacy Auth identity is ambiguous; reconcile it in Suite Admin.');
  if(existing.rows.length===1){await connection.query('COMMIT');return existing.rows[0];}
  if(profile.preferredId){const collision=await connection.query('SELECT id FROM users WHERE id::text=$1 FOR UPDATE',[profile.preferredId]);if(collision.rows.length)throw new Error('Source profile ID belongs to another backend identity. Explicit reconciliation is required.');}
  // Serialize display-name allocation too; a name collision never establishes ownership.
  const preferred=profile.username.trim().slice(0,150);
  await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('legacy-name:'||$1,0))",[preferred]);
  const occupied=await connection.query('SELECT id FROM users WHERE username=$1',[preferred]);
  const username=occupied.rows.length?preferred+'-'+profile.authId:preferred;
  const created=await connection.query(`INSERT INTO users(id,auth_id,username,password_hash,name,role,clinic_name,clinic_address,contact_phone,contact_email,contact_whatsapp,whatsapp_integration_available,max_sessions,created_at,updated_at)
   VALUES(coalesce($1::uuid,gen_random_uuid()),$2,$3,NULL,$4,'user',$5,$6,$7,$8,$9,true,1,now(),now())
   RETURNING id,auth_id,username,name,role`,[profile.preferredId||null,profile.authId,username,profile.name,profile.clinicName||profile.name,profile.clinicAddress||'',profile.contactPhone||'',profile.contactEmail||profile.username,profile.contactWhatsapp||profile.contactPhone||'']);
  await connection.query('COMMIT');return created.rows[0];
 }catch(error){await connection.query('ROLLBACK');throw error;}
}
