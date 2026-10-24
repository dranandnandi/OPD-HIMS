import {useEffect,useRef,useState} from 'react';
const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');
if(location.pathname==='/suite-entry')history.replaceState(null,'','/suite-entry');
export default function SuiteEntry(){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;
 void(async()=>{
  if(!ticket||!/^[a-f0-9]{64}$/.test(ticket))throw Error('Open a fresh product link from Doctor Suite.');
  const response=await fetch('/api/suite/entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
  const data=await response.json();if(!response.ok||typeof data.token!=='string'||!data.user?.id)throw Error('This login link expired or product access is inactive.');
  localStorage.setItem('wa_auth_token',data.token);localStorage.setItem('wa_auth_user',JSON.stringify(data.user));location.replace('/');
 })().catch(e=>setError(e instanceof Error?e.message:'Sign-in unavailable.'));
 },[]);
 return <main style={{maxWidth:520,margin:'15vh auto',padding:24,fontFamily:'system-ui'}}><h1>Opening WhatsApp</h1><p role={error?'alert':'status'}>{error||'Verifying your account and current access...'}</p></main>;
}
