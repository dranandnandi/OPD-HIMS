import { SuiteError, PRODUCTS, uuid } from './suite-contract.ts';
import { invitationHash } from './suite-invitations.ts';
import type { SuiteRpc } from './suite-delivery.ts';
export async function createLaunch(rpc:SuiteRpc,user:string,input:Record<string,unknown>){
 const org=uuid(input.organization_id,'organisation');const product=String(input.product_code);
 if(!PRODUCTS.includes(product as typeof PRODUCTS[number]))throw new SuiteError('Invalid product.');
 const base=Deno.env.get(`SUITE_${product.toUpperCase()}_APP_URL`);
 let url:URL;try{url=new URL(base||'');}catch{throw new SuiteError('This product launcher is not configured.',503);}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new SuiteError('Invalid product launcher configuration.',503);
 url.pathname=url.pathname.replace(/\/$/,'')+'/suite-entry';
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
 await rpc('suite_create_launch',{p_user:user,p_org:org,p_product:product,p_hash:await invitationHash(token)});
 url.hash=`ticket=${token}`;
 return {launch_url:url.href,expires_in:60};
}
