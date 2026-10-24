import fs from 'node:fs';
import path from 'node:path';
import {editPackage,roots} from './package-edit.mjs';
const pkg=editPackage();
const clients={opd:'../lib/supabase',growth:'../services/supabaseClient',workforce:'../utils/supabaseClient'};
for(const product of Object.keys(roots)){
 let main=fs.readFileSync(path.join(roots[product],'src/main.tsx'),'utf8').replaceAll('\r\n','\n');
 if(main.includes('SuiteBoundary'))throw Error('Frontend already integrated; review instead of replacing it.');
 const growth=product==='growth';
 const extra=growth?`import {hydrateSuiteUser,clearSuiteUser} from './suite/profile';\n`:'';
 const onReady=growth?'hydrateSuiteUser':product==='opd'?'clearProductCache':undefined;
 const cache=product==='opd'?`const clearProductCache=async()=>{localStorage.removeItem('bolt_user_profile');};\n`:'';
 main=`import SuiteEntry from './suite/SuiteEntry';\nimport SuiteBoundary from './suite/SuiteBoundary';\nimport {supabase} from '${clients[product].replace('../','./')}';\n${extra}${main}`;
 main=main.replace(/(createRoot\(|ReactDOM\.createRoot\()/,cache+'$1');
 main=main.replace('<App />',`{location.pathname==='/suite-entry'?<SuiteEntry client={supabase}${onReady?' onReady={'+onReady+'}':''}/>:<SuiteBoundary client={supabase}${growth?' onAuthenticated={hydrateSuiteUser} onSignedOut={clearSuiteUser}':''}><App /></SuiteBoundary>}`);
 pkg.put(product,'src/main.tsx',main);
 // Only attach a session to this product's same-origin Netlify functions.
 pkg.put(product,'src/suite/productFetch.ts',`import {supabase} from '${clients[product]}';
export async function productFetch(input:RequestInfo|URL,options?:RequestInit):Promise<Response>{
 const request=new Request(input instanceof Request?input:new URL(String(input),location.href),options);
 const url=new URL(request.url);
 if(url.origin!==location.origin||!url.pathname.startsWith('/.netlify/functions/'))return fetch(request);
 const result=await supabase?.auth.getSession();const token=result?.data.session?.access_token;
 if(!token)throw new Error('Sign in again before using WhatsApp.');
 const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+token);
 return fetch(new Request(request,{headers}));
}
`);
 if(product!=='workforce'){
  const relative='src/services/whatsappApi.ts';let api=pkg.read(product,relative);
  api=`import {productFetch} from '../suite/productFetch';\n`+api.replace(/\bfetch\(/g,'productFetch(');
  pkg.put(product,relative,api);
 }
}
// Reuse the app's own complete profile mapping; never infer identity from email.
const store=fs.readFileSync(path.join(roots.growth,'src/store/useStore.ts'),'utf8');
const mapping=store.match(/const user = \{\s*id: userData\.id,[\s\S]*?\n\s*\};/)[0];
pkg.put('growth','src/suite/profile.ts',`import {supabase} from '../services/supabaseClient';
import {useStore} from '../store/useStore';
export function clearSuiteUser(){
 useStore.setState({user:null,appointments:[],reviews:[],creatives:[],categories:[],reportRequests:[],reviewRequestTemplates:[],sequenceMessages:[],sequenceTemplates:[],aiGeneratedTemplates:[],cache:{categories:null,sequenceTemplates:null,reviewRequestTemplates:null}});
}
export async function hydrateSuiteUser(){
 const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('Sign in again.');
 const who=data.user.id;
 const profile=await supabase.from('users').select('*').eq('auth_id',who).single();
 if(profile.error||!profile.data)throw new Error('Your linked product profile is unavailable.');
 const current=await supabase.auth.getSession();if(current.data.session?.user.id!==who)throw new Error('Account changed during sign-in.');
 const userData=profile.data;
 ${mapping}
 clearSuiteUser();useStore.getState().setUser(user);
}
`);
pkg.save();console.log('Staged three product entry points and authenticated browser transports.');
