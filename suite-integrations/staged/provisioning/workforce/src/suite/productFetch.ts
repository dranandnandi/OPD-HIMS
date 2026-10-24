import {supabase} from '../utils/supabaseClient';
export async function productFetch(input:RequestInfo|URL,options?:RequestInit):Promise<Response>{
 const request=new Request(input instanceof Request?input:new URL(String(input),location.href),options);
 const url=new URL(request.url);
 if(url.origin!==location.origin||!url.pathname.startsWith('/.netlify/functions/'))return fetch(request);
 const result=await supabase?.auth.getSession();const token=result?.data.session?.access_token;
 if(!token)throw new Error('Sign in again before using WhatsApp.');
 const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+token);
 return fetch(new Request(request,{headers}));
}
