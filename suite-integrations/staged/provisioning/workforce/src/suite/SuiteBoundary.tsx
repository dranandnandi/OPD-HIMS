import{useEffect,useRef,useState,type ReactNode}from'react';
import type{SupabaseClient}from'@supabase/supabase-js';
type State={allowed:boolean;managed:boolean;access_until?:string;fresh_until?:string};
export default function SuiteBoundary({client,children,onAuthenticated,onSignedOut}:{client:SupabaseClient|null;children:ReactNode;onAuthenticated?:()=>Promise<void>;onSignedOut?:()=>void}){
 const[state,setState]=useState<State|null>(null),[error,setError]=useState(''),generation=useRef(0);
 useEffect(()=>{if(!client){setError('Product sign-in is not configured.');return;}
  let timer:ReturnType<typeof setTimeout>|undefined,interval:ReturnType<typeof setInterval>|undefined,active=true,subject:string|null|undefined=undefined,hydrated:string|undefined,loading=false;
  const check=async()=>{
   if(loading||!subject)return;loading=true;const who=subject,request=generation.current;
   try{
    const result=await client.rpc('ds_client_status');if(result.error)throw new Error('Access verification is unavailable. Please retry shortly.');
    if(!active||request!==generation.current||who!==subject)return;
    const next=result.data as State;
    if(!next||typeof next.allowed!=='boolean'||typeof next.managed!=='boolean')throw new Error('Invalid access response.');
    if(next.allowed&&onAuthenticated&&hydrated!==who){await onAuthenticated();hydrated=who;}
    if(!active||request!==generation.current||who!==subject)return;
    clearTimeout(timer);setState(next);setError('');
    if(next.managed&&next.allowed){const deadline=Math.min(Date.parse(next.access_until||''),Date.parse(next.fresh_until||''));if(!Number.isFinite(deadline)||deadline<=Date.now()){setState({...next,allowed:false});return;}timer=setTimeout(()=>{setState(previous=>previous?{...previous,allowed:false}:null);void check();},Math.min(2147483647,deadline-Date.now()));}
   }catch(e){if(active&&request===generation.current){setState(null);setError(e instanceof Error?e.message:'Access verification failed.');}}
   finally{loading=false;}
  };
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{
   const next=session?.user.id||null;if(next===subject)return;subject=next;generation.current++;loading=false;clearTimeout(timer);setState(null);setError('');
   if(!next){onSignedOut?.();setState({allowed:true,managed:false});}else setTimeout(()=>void check(),0);
  });
  interval=setInterval(()=>void check(),15000);
  return()=>{active=false;generation.current++;subscription.unsubscribe();clearInterval(interval);clearTimeout(timer);};
 },[client,onAuthenticated,onSignedOut]);
 if(state?.allowed)return <>{children}</>;
 return <main style={{maxWidth:520,margin:'15vh auto',padding:24,fontFamily:'system-ui'}}><h1>{state?'Product access inactive':'Checking access'}</h1><p role={error?'alert':'status'}>{error||(!state?'Verifying your account...':'Ask your organisation administrator to activate or renew access in Doctor Suite.')}</p>{(state||error)&&<button onClick={()=>void client?.auth.signOut()}>Sign out</button>}</main>;
}
