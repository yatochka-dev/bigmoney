const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const app = $('#app');
const CONFIG_KEY = 'bm.supabase.config';
const SESSION_KEY = 'bm.supabase.session';
const TABLES = ['app_settings','months','categories','cards','transactions','installments','month_budgets'];
const DEFAULT_CATEGORIES = [
  ['Groceries','need',1150],['Dining & Delivery','want',700],['Transport','need',300],['Subscriptions','need',150],
  ['Clothes & Shopping','want',1000],['Health & Pharmacy','need',300],['Music & Gear','want',500],['Travel & Tourism','want',0],
  ['Home','need',500],['Entertainment','want',300],['Gifts','want',200],['Education','need',300],['Savings / Investing','saving',0],['Other','want',250]
];
const COLORS = ['#18c37e','#7085ff','#e7b65c','#e56e8b','#9a78ff','#4db7c5','#d7783f','#76a95b','#cb8cdf','#7f8ca5'];
const PAYMENT_LABELS = {cash:'Cash',debit:'Debit',bank_transfer:'Bank transfer',credit_card:'Credit card'};
const state = { view:'dashboard', selectedMonth:monthKey(new Date()), user:null, data:emptyData(), basis:'purchase', search:'', menu:false, syncing:false };
let dbPromise;

function emptyData(){return {settings:null,months:[],categories:[],cards:[],transactions:[],installments:[],budgets:[]}}
function uuid(){return crypto.randomUUID()}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function money(v,dec=0){return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:dec,maximumFractionDigits:dec}).format(Number(v)||0)}
function monthKey(d){if(typeof d==='string')d=new Date(`${d}T12:00:00`);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function monthLabel(key){const [y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(new Date(y,m-1,1))}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function addMonths(date,count){const d=new Date(`${date}T12:00:00`),day=d.getDate();const target=new Date(d.getFullYear(),d.getMonth()+count,1);const max=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();target.setDate(Math.min(day,max));return `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(target.getDate()).padStart(2,'0')}`}
function nextBillingDate(date,billingDay){const d=new Date(`${date}T12:00:00`);const tm=d.getDate()<=billingDay?d.getMonth():d.getMonth()+1;const max=new Date(d.getFullYear(),tm+1,0).getDate();const x=new Date(d.getFullYear(),tm,Math.min(billingDay,max));return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}
function installmentAmounts(total,count){const cents=Math.round(total*100),base=Math.floor(cents/count),rem=cents-base*count;return Array.from({length:count},(_,i)=>(base+(i===count-1?rem:0))/100)}
function daysInMonth(key){const [y,m]=key.split('-').map(Number);return new Date(y,m,0).getDate()}
function elapsedDays(key){return monthKey(new Date())===key?new Date().getDate():daysInMonth(key)}
function toast(text,bad=false){const old=$('.toast');if(old)old.remove();const el=document.createElement('div');el.className=`toast ${bad?'bad':''}`;el.textContent=text;document.body.appendChild(el);setTimeout(()=>el.remove(),2800)}

function getConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')}catch{return null}}
function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function setSession(s){if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY)}

function openDB(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('big-money-ledger',1);req.onupgradeneeded=()=>{const db=req.result;for(const name of [...TABLES,'pending_ops']){if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'id'});store.createIndex('user_id','user_id',{unique:false})}}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return dbPromise}
async function idbAll(store){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbPut(store,row){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).put(row);r.onsuccess=()=>res(row);r.onerror=()=>rej(r.error)})}
async function idbDelete(store,id){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function replaceUserTable(store,userId,rows){const db=await openDB();const tx=db.transaction(store,'readwrite'),os=tx.objectStore(store),idx=os.index('user_id');const keys=await new Promise((res,rej)=>{const r=idx.getAllKeys(IDBKeyRange.only(userId));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});keys.forEach(k=>os.delete(k));rows.forEach(r=>os.put(r));return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function userRows(store,userId){return (await idbAll(store)).filter(r=>r.user_id===userId)}

async function refreshSession(){const config=getConfig(),session=getSession();if(!config||!session?.refresh_token)throw new Error('Not signed in');const res=await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!res.ok)throw new Error((await safeJson(res))?.msg||'Session expired');const next=await res.json();next.expires_at=Math.floor(Date.now()/1000)+next.expires_in;setSession(next);return next}
async function validSession(){let s=getSession();if(!s)return null;if(s.expires_at && s.expires_at<Math.floor(Date.now()/1000)+60){if(!navigator.onLine)return s;try{s=await refreshSession()}catch{setSession(null);return null}}return s}
async function authFetch(path,opts={},retry=true){const config=getConfig();if(!config)throw new Error('Database is not configured');let session=await validSession();if(!session)throw new Error('Not signed in');const headers={apikey:config.key,Authorization:`Bearer ${session.access_token}`,...opts.headers};const res=await fetch(`${config.url}${path}`,{...opts,headers});if(res.status===401&&retry){await refreshSession();return authFetch(path,opts,false)}return res}
async function safeJson(res){try{return await res.json()}catch{return null}}
async function remoteRows(table,userId){const res=await authFetch(`/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&select=*`,{headers:{Accept:'application/json'}});if(!res.ok)throw new Error((await safeJson(res))?.message||`Could not read ${table}`);return res.json()}
async function remoteUpsert(table,row){const res=await authFetch(`/rest/v1/${table}?on_conflict=id`,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});if(!res.ok)throw new Error((await safeJson(res))?.message||`Could not write ${table}`)}
async function remoteDelete(table,id){const res=await authFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});if(!res.ok)throw new Error((await safeJson(res))?.message||`Could not delete ${table}`)}
async function queueOp(table,operation,payload){await idbPut('pending_ops',{id:uuid(),user_id:state.user.id,table_name:table,operation,payload,created_at:new Date().toISOString()})}
async function writeRow(table,row){await idbPut(table,row);if(navigator.onLine){try{await remoteUpsert(table,row);return}catch(e){console.warn(e)}}await queueOp(table,'upsert',row)}
async function deleteRow(table,id){await idbDelete(table,id);if(navigator.onLine){try{await remoteDelete(table,id);return}catch(e){console.warn(e)}}await queueOp(table,'delete',{id})}
async function flushQueue(){if(!navigator.onLine||!state.user)return;const ops=(await userRows('pending_ops',state.user.id)).sort((a,b)=>a.created_at.localeCompare(b.created_at));for(const op of ops){try{if(op.operation==='upsert')await remoteUpsert(op.table_name,op.payload);else await remoteDelete(op.table_name,op.payload.id);await idbDelete('pending_ops',op.id)}catch(e){console.warn('Queued operation still pending',e)}}}
async function pullRemote(){if(!navigator.onLine||!state.user)return;const remaining=await userRows('pending_ops',state.user.id);if(remaining.length)return;for(const table of TABLES){const rows=await remoteRows(table,state.user.id);await replaceUserTable(table,state.user.id,rows)}}
async function syncAll(showToast=true){if(!state.user||!navigator.onLine)return;state.syncing=true;render();try{await flushQueue();await pullRemote();await ensureSeed();await loadData();if(showToast)toast('Ledger synced')}catch(e){console.error(e);if(showToast)toast(e.message||'Sync failed',true)}finally{state.syncing=false;render()}}

async function loadData(){const id=state.user.id;const [settings,months,categories,cards,transactions,installments,budgets]=await Promise.all(TABLES.map(t=>userRows(t,id)));state.data={settings:settings[0]||null,months:months.sort((a,b)=>b.month_key.localeCompare(a.month_key)),categories:categories.sort((a,b)=>a.sort_order-b.sort_order),cards,transactions,installments,budgets};if(!state.data.months.some(m=>m.month_key===state.selectedMonth))state.selectedMonth=state.data.months.find(m=>m.month_key===monthKey(new Date()))?.month_key||state.data.months[0]?.month_key||monthKey(new Date())}
async function ensureSeed(){const id=state.user.id;let settings=(await userRows('app_settings',id))[0];if(!settings){settings={id:uuid(),user_id:id,expected_salary_default:15500,currency:'ILS',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};await writeRow('app_settings',settings)}let cats=await userRows('categories',id);if(!cats.length){for(let i=0;i<DEFAULT_CATEGORIES.length;i++){const [name,kind,budget]=DEFAULT_CATEGORIES[i],row={id:uuid(),user_id:id,name,kind,default_budget:budget,sort_order:i,created_at:new Date().toISOString()};await writeRow('categories',row)}cats=await userRows('categories',id)}const current=monthKey(new Date());const months=await userRows('months',id);if(!months.some(m=>m.month_key===current))await createMonth(current)}
async function createMonth(key){const id=state.user.id,months=await userRows('months',id);if(months.some(m=>m.month_key===key))return;const settings=(await userRows('app_settings',id))[0],row={id:uuid(),user_id:id,month_key:key,expected_salary:settings?.expected_salary_default??15500,actual_salary:null,notes:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};await writeRow('months',row);const cats=await userRows('categories',id);for(const c of cats)await writeRow('month_budgets',{id:uuid(),user_id:id,month_key:key,category_id:c.id,amount:c.default_budget,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})}

function render(){if(!getConfig())return renderBackendSetup();if(!state.user)return renderAuth();renderApp()}
