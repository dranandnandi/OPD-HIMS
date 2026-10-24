import {useEffect,useState}from'react';
import{api,type Detail}from'./api';
import type{Dialog}from'./App';
type Identity={product_code:string;member_id:string;local_user_id:string;local_tenant_id:string};
export default function ProductIdentities({detail,busy,open}:{detail:Detail;busy:boolean;open:(dialog:Dialog)=>void}){
 const[rows,setRows]=useState<Identity[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const version=detail.bindings.map(b=>`${b.product_code}:${b.version}`).join(',');
 useEffect(()=>{let active=true;setLoaded(false);setError('');void api<Identity[]>('identity_detail',{organization_id:detail.organization.id}).then(result=>{if(active){setRows(result);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[detail.organization.id,version]);
 const members=detail.members.filter(m=>m.status==='active'&&m.auth_user_id&&m.role!=='billing');
 return <section className="panel"><div className="panel-title"><h2>Product logins</h2></div><p className="muted">Approve an exact existing product account for a verified suite member. The server verifies that the account belongs to this organisation's linked product tenant.</p>
 {error&&<p className="inline-error" role="alert">{error}</p>}
 {rows.map(row=><div className="product-row" key={`${row.product_code}:${row.member_id}`}><div className="product-description"><strong>{detail.members.find(m=>m.id===row.member_id)?.name||'Member'} · {row.product_code}</strong><small>Product user: {row.local_user_id}</small></div><span className="badge linked">Linked</span></div>)}
 <button className="secondary" disabled={busy||!loaded||!members.length||!detail.bindings.some(b=>b.local_tenant_id)} onClick={()=>open({title:'Approve an existing product login',action:'link_product_identity',base:{organization_id:detail.organization.id},note:'Check the person and exact product user ID before approval. Email matches alone do not link accounts. Existing mappings cannot be silently replaced.',fields:[{name:'product_code',label:'Product',options:detail.bindings.filter(b=>b.local_tenant_id).map(b=>({value:b.product_code,label:b.product_code}))},{name:'member_id',label:'Verified suite member',options:members.map(m=>({value:m.id,label:`${m.name} (${m.email})`}))},{name:'local_user_id',label:'Exact product profile / public user ID'},{name:'reason',label:'Reason for approving this identity'}]})}>Approve login</button>
 <p className="quiet">Customers sign in at /apps on this admin site. Product launch remains blocked until setup and access are active.</p>
 </section>;
}
