import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUITE_SUPABASE_URL,key=import.meta.env.VITE_SUITE_SUPABASE_PUBLISHABLE_KEY;
export const member=url&&key?createClient(url,key,{auth:{storageKey:'doctor-suite-member-session',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
export async function memberApi<T>(action:string,values:Record<string,unknown>={}):Promise<T>{
 if(!member)throw new Error('Member sign-in is not configured.');
 const {data:{session}}=await member.auth.getSession();if(!session)throw new Error('Sign in first.');
 const response=await fetch(`${url}/functions/v1/suite-member`,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${session.access_token}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({...values,action})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Member service is unavailable.');return result;
}
