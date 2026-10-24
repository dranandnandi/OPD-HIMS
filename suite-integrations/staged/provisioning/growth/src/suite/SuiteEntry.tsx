import {useEffect,useRef,useState}from'react';
import type{SupabaseClient}from'@supabase/supabase-js';
const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');
if(location.pathname==='/suite-entry')history.replaceState(null,'','/suite-entry');
export default function SuiteEntry({client,onReady}:{client:SupabaseClient|null;onReady?:()=>Promise<void>}){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;
  void(async()=>{
   if(!client||!ticket||!/^[a-f0-9]{64}$/.test(ticket))throw new Error('Open a fresh product link from your Doctor Suite account.');
   const {data,error:entryError}=await client.functions.invoke('suite-entry',{body:{ticket}});
   if(entryError||!data?.token_hash||!data.local_auth_id)throw new Error('This login link is unavailable or expired. Open the product again from Doctor Suite.');
   const result=await client.auth.verifyOtp({token_hash:data.token_hash,type:'magiclink'});
   if(result.error||result.data.user?.id!==data.local_auth_id)throw new Error('Product sign-in could not be verified.');
   if(onReady)await onReady();location.replace('/');
  })().catch(e=>setError(e instanceof Error?e.message:'Unable to open the product.'));
 },[client,onReady]);
 return <main style={{maxWidth:520,margin:'15vh auto',padding:24,fontFamily:'system-ui'}}><h1>Opening your product</h1><p role={error?'alert':'status'}>{error||'Verifying your account and current access...'}</p></main>;
}
