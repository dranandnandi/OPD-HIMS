import {useEffect,useRef,useState}from'react';
import type{Session}from'@supabase/supabase-js';
import{member,memberApi}from'./member-api';
type AppAccess={organization_id:string;organization_name:string;product_code:string;product_name:string;state:string;identity_linked:boolean;allowed:boolean};
export default function MemberApps(){
 const[session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[apps,setApps]=useState<AppAccess[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const principal=useRef<string|null>(null);
 useEffect(()=>{if(!member){setReady(true);return;}const{data:{subscription}}=member.auth.onAuthStateChange((_event,next)=>{if(principal.current!==(next?.user.id||null)){setApps([]);setError('');principal.current=next?.user.id||null;}setSession(next);setReady(true);});return()=>subscription.unsubscribe();},[]);
 useEffect(()=>{if(!session)return;let active=true;void memberApi<AppAccess[]>('list_apps').then(value=>{if(active)setApps(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session?.user.id]);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}};
 return <div className="login-form-wrap" style={{minHeight:'100vh'}}><section className="login-form" style={{maxWidth:680}}><div className="eyebrow">DOCTOR SUITE</div><h2>Your products</h2>
 {error&&<div className="alert error" role="alert">{error}</div>}
 {!ready?<p>Checking sign-in...</p>:!member?<p>Sign-in is not configured.</p>:!session?<form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{const result=await member!.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});if(result.error)throw result.error;});}}><p>Sign in with your verified suite account.</p><label className="field">Email<input name="email" type="email" required autoComplete="username"/></label><label className="field">Password<input name="password" type="password" required autoComplete="current-password"/></label><button className="primary" disabled={busy}>Sign in</button></form>:<>
 <p>{session.user.email}</p>{!apps.length&&<p>No products are available yet. Your administrator can finish account setup.</p>}
 {apps.map(app=><div className="product-row" key={`${app.organization_id}:${app.product_code}`}><div className="product-description"><strong>{app.product_name}</strong><small>{app.organization_name}</small><small>{app.allowed?'Access active':!app.identity_linked?'Login linking pending':app.state!=='ready'?'Setup pending':'Access inactive'}</small></div><button className="secondary" disabled={busy||!app.allowed} onClick={()=>void run(async()=>{const who=session.user.id;const result=await memberApi<{launch_url:string}>('launch_product',{organization_id:app.organization_id,product_code:app.product_code});if(principal.current===who)location.assign(result.launch_url);})}>Open</button></div>)}
 <button className="text-button" disabled={busy} onClick={()=>void run(async()=>{const result=await member!.auth.signOut();if(result.error)throw result.error;})}>Sign out</button></>}
 </section></div>;
}
