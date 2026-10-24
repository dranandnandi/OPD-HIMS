import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { object, SuiteError } from '../_shared/suite-contract.ts';
import { invitationHash, parseInvitationToken } from '../_shared/suite-invitations.ts';
import { createLaunch } from '../_shared/suite-launch.ts';

// Separate customer endpoint. It never grants Suite Super Admin authority.
export async function handleSuiteMember(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin'); const allowed = (Deno.env.get('SUITE_MEMBER_ALLOWED_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
  const headers: Record<string,string> = { 'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',
    'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info' };
  if(origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin && !allowed.includes(origin))return reply({error:'Origin is not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Use POST.'},405);
  try {
    const token=req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if(!token)throw new SuiteError('Sign in with your invited account.',401);
    const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!key)throw new SuiteError('Member service is not configured.',503);
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.getUser(token);
    if(error||!data.user?.email_confirmed_at)throw new SuiteError('Sign in and verify your email first.',401);
    const raw=await req.text();if(raw.length>2048)throw new SuiteError('Request too large.',413);
    let input:Record<string,unknown>;
    try{input=object(JSON.parse(raw));}catch{throw new SuiteError('Invalid request.');}
    const rpc=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.rpc(name,args);
      if(result.error)throw new SuiteError(result.error.code==='P0001'?result.error.message:'Membership service is unavailable.',result.error.code==='P0001'?409:503);
      return result.data;
    };
    if(input.action==='list_apps')return reply(await rpc('suite_member_apps',{p_user:data.user.id}));
    if(input.action==='launch_product')return reply(await createLaunch(rpc,data.user.id,input));
    if(input.action!=='accept_invitation')throw new SuiteError('Unsupported member action.');
    const hash=await invitationHash(parseInvitationToken(input.invitation_token));
    const result=await client.rpc('suite_accept_invitation',{p_user:data.user.id,p_hash:hash});
    if(result.error)throw new SuiteError(result.error.code==='P0001'?'Invitation is invalid, expired or does not match your verified account.':'Membership service is unavailable.',result.error.code==='P0001'?409:503);
    return reply(result.data);
  }catch(error){return reply({error:error instanceof SuiteError?error.message:'Membership service is unavailable.'},error instanceof SuiteError?error.status:500);}
}
if(import.meta.main)Deno.serve(handleSuiteMember);
