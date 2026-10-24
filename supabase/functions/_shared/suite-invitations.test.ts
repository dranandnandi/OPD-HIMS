import { createInvitation, invitationHash } from './suite-invitations.ts';
import { handleSuiteMember } from '../suite-member/index.ts';
import { parseCommand } from './suite-contract.ts';
function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed'); }
const actor='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
Deno.test('invitation links retry deterministically, store only hashes and reject unsafe portal configuration', async()=>{
  const names=['SUITE_INVITE_SIGNING_KEY','SUITE_MEMBER_PORTAL_URL']; const old=names.map(n=>Deno.env.get(n));
  try {
    Deno.env.set(names[0],'test-only-invitation-secret-at-least-32-chars');Deno.env.set(names[1],'https://suite.invalid/join');
    const command=parseCommand({action:'create_invitation',request_id:actor,organization_id:org,member_id:actor,role:'super_admin'});
    assert(!('role' in command.payload));let stored='';
    const rpc=async(name:string,args:Record<string,unknown>)=>{assert(name==='suite_issue_invitation'); stored=String(args.p_hash);return {invitation_id:org};};
    const one=await createInvitation(rpc,actor,org,command.payload);
    const two=await createInvitation(rpc,actor,org,command.payload);assert(one.invitation_url===two.invitation_url);
    const token=new URLSearchParams(new URL(one.invitation_url).hash.slice(1)).get('invite')!;
    assert(stored!==token && stored===await invitationHash(token));
    Deno.env.set(names[1],'https://suite.invalid/join?leak=yes');let failed=false;
    try{await createInvitation(rpc,actor,org,command.payload);}catch{failed=true;} assert(failed);
  } finally {names.forEach((n,i)=>old[i]===undefined?Deno.env.delete(n):Deno.env.set(n,old[i]!));}
});
Deno.test('member endpoint uses verified Auth identity and ignores supplied role and user ID',async()=>{
  const vars={SUPABASE_URL:'https://central.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUITE_MEMBER_ALLOWED_ORIGINS:'https://suite.invalid'};
  const old=Object.fromEntries(Object.keys(vars).map(n=>[n,Deno.env.get(n)]));const oldFetch=globalThis.fetch;
  let calls=0,verified=true;
  try {
    for(const [n,v]of Object.entries(vars))Deno.env.set(n,v);
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      calls++;const url=String(input);
      if(url.endsWith('/auth/v1/user'))return Response.json({id:actor,email:'owner@example.com',email_confirmed_at:verified?'2026-01-01T00:00:00Z':null});
      assert(url.endsWith('/rest/v1/rpc/suite_accept_invitation'));
      const body=JSON.parse(String(init?.body));assert(body.p_user===actor && !('role' in body) && body.p_hash===await invitationHash('a'.repeat(64)));
      return Response.json({accepted:true});
    })as typeof fetch;
    const request=(authorization=true,origin='https://suite.invalid')=>new Request('https://central.invalid/functions/v1/suite-member',{method:'POST',headers:{Origin:origin,...authorization?{Authorization:'Bearer actual-user'}:{}},body:JSON.stringify({action:'accept_invitation',invitation_token:'a'.repeat(64),user_id:org,role:'super_admin'})});
    assert((await handleSuiteMember(request(false))).status===401 && Number(calls)===0);
    assert((await handleSuiteMember(request(true,'https://evil.invalid'))).status===403 && Number(calls)===0);
    assert((await handleSuiteMember(request())).status===200 && Number(calls)===2);
    verified=false;assert((await handleSuiteMember(request())).status===401 && Number(calls)===3);
  } finally {globalThis.fetch=oldFetch;for(const[n,v]of Object.entries(old))v===undefined?Deno.env.delete(n):Deno.env.set(n,v);}
});
