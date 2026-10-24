import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('Suite invitation identity, expiry and retry boundaries', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  for (const file of ['20261018120000_suite_platform.sql','20261019120000_suite_operations.sql','20261019160000_suite_invitations.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  }
  const actor=randomUUID(), owner=randomUUID(), stranger=randomUUID();
  const rpc=async(name,args)=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
  const org=(await rpc('suite_mutate',[actor,randomUUID(),'create_organization',JSON.stringify({name:'Invited clinic',owner_name:'Invited owner',owner_email:'invited@example.com',plan_code:'doctor_complete'})])).organization_id;
  const member=(await rpc('suite_detail',[org])).members[0].id;
  await db.query('INSERT INTO auth.users VALUES ($1,$2,NULL),($3,$4,now())',[owner,'invited@example.com',stranger,'other@example.com']);
  const hash=()=>createHash('sha256').update(randomUUID()).digest('hex');
  const token=hash(), request=randomUUID();
  const first=await rpc('suite_issue_invitation',[actor,request,org,member,token]);
  await t.test('issue is idempotent, tenant scoped and unavailable to browser roles',async()=>{
    assert.deepEqual(await rpc('suite_issue_invitation',[actor,request,org,member,token]),first);
    await assert.rejects(rpc('suite_issue_invitation',[actor,request,org,member,hash()]),/another operation/);
    await assert.rejects(rpc('suite_issue_invitation',[actor,randomUUID(),randomUUID(),member,hash()]),/pending unlinked/);
    for(const role of ['anon','authenticated']) {
      assert.equal((await db.query("SELECT has_table_privilege($1,'suite_invitations','SELECT,INSERT,UPDATE,DELETE') AS allowed",[role])).rows[0].allowed,false);
      for(const signature of ['suite_issue_invitation(uuid,uuid,uuid,uuid,text)','suite_accept_invitation(uuid,text)']) assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature])).rows[0].allowed,false);
    }
  });
  await t.test('unverified email, different account and unknown token cannot accept',async()=>{
    for(const [user,h] of [[owner,token],[stranger,token],[owner,hash()]]) await assert.rejects(rpc('suite_accept_invitation',[user,h]),/Invalid invitation/);
    assert.equal((await rpc('suite_detail',[org])).members[0].status,'pending');
  });
  const replacement=hash();
  await t.test('reissue invalidates old link and exact expiry is denied',async()=>{
    await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[owner]);
    await rpc('suite_issue_invitation',[actor,randomUUID(),org,member,replacement]);
    await assert.rejects(rpc('suite_accept_invitation',[owner,token]),/Invalid invitation/);
    await db.query("UPDATE suite_invitations SET created_at=now()-interval '8 days',expires_at=now() WHERE token_hash=$1",[replacement]);
    await assert.rejects(rpc('suite_accept_invitation',[owner,replacement]),/Invalid invitation/);
  });
  await t.test('accept links verified account once, queues setup and never starts trial',async()=>{
    const active=hash();await rpc('suite_issue_invitation',[actor,randomUUID(),org,member,active]);
    const result=await rpc('suite_accept_invitation',[owner,active]);assert.equal(result.accepted,true);
    assert.deepEqual(await rpc('suite_accept_invitation',[owner,active]),result);
    const detail=await rpc('suite_detail',[org]);
    assert.equal(detail.members[0].auth_user_id,owner);assert.equal(detail.members[0].status,'active');
    assert.equal(detail.organization.trial_started_at,null);assert.ok(detail.bindings.every(b=>b.state==='pending'));
    assert.equal(detail.audit.filter(a=>a.action==='accept_invitation').length,1);
    await db.query("UPDATE suite_memberships SET status='disabled' WHERE id=$1",[member]);
    await assert.rejects(rpc('suite_accept_invitation',[owner,active]),/Invalid invitation/);
  });
});
