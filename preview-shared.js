// Preview-only frontend test workflow. Uses the existing tables/API; installs no SQL or policies.
// These controls prevent accidental UI mutations; they do not replace database authorization.
(function(){
 'use strict';
 const TAG='[PREVIEW_TEST_20261014]';
 const PROD_HOST='rss-itadmin-ipad-borrow.vercel.app';
 const email=value=>String(value||'').trim().toLowerCase();
 const el=id=>document.getElementById(id);
 let submitting=false;
 const writable=()=>location.hostname!==PROD_HOST && (
  ['localhost','127.0.0.1'].includes(location.hostname) ||
  /^rss-itadmin-ipad-borrow-[a-z0-9-]+\.vercel\.app$/.test(location.hostname));
 const isTestBooking=b=>String(b?.remarks||'').startsWith(TAG+' ');
 function allowWrites(){if(!writable())throw Error('此版本只允許在 Preview 網址測試，正式網址禁止寫入。')}
 async function actor(){
  const {data,error}=await _supabase.auth.getUser();if(error||!data?.user)throw Error('請先登入學校 Google 帳號。');
  const user=data.user;
  const [{data:teachers,error:tError},{data:admins,error:aError}]=await Promise.all([
   _supabase.from('teachers').select('name,email,is_suspended,suspended_until'),
   _supabase.from('admins').select('email')
  ]);
  if(tError||aError)throw tError||aError;
  const isAdmin=admins.some(a=>email(a.email)===email(user.email));
  const names=new Set(teachers.filter(t=>email(t.email)===email(user.email)).map(t=>t.name));
  if(!isAdmin&&!names.size)throw Error('此帳號未列於教師名單。');
  return {user,teachers,isAdmin,names};
 }
 async function readRange(start,end){
  const all=[];for(let offset=0;;offset+=1000){
   const {data,error}=await _supabase.from('bookings').select('*').gte('date',start).lte('date',end)
    .order('date').order('lesson').order('created_at').order('id').range(offset,offset+999);
   if(error)throw error;all.push(...data);if(data.length<1000)return all;
  }
 }
 async function loadMine(){
  const {names}=await actor();if(!names.size)return [];
  const all=[];for(let offset=0;;offset+=1000){
   const {data,error}=await _supabase.from('bookings').select('*').in('teacher_name',[...names])
    .order('date').order('lesson').order('created_at').order('id').range(offset,offset+999);
   if(error)throw error;all.push(...data);if(data.length<1000)return all;
  }
 }
 const identity=b=>JSON.stringify([b.date,Number(b.lesson),b.teacher_name,b.device_type,b.class,Number(b.quantity)]);
 async function submitEntries(entries){
  allowWrites();const a=await actor();
  if(!entries.length||entries.length>30)throw Error('每次須提交 1 至 30 筆。');
  const normalized=entries.map(e=>({...e,lesson:Number(e.lesson),quantity:Number(e.quantity)}))
   .sort((x,y)=>x.date.localeCompare(y.date)||x.lesson-y.lesson);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const seen=new Set();
  for(const e of normalized){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(new Date(e.date+'T12:00:00Z').getTime())||new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)!==e.date||e.date<today||!Number.isInteger(e.lesson)||e.lesson<1||e.lesson>7)throw Error('請選擇今天或以後的有效日期及課節。');
   if(e.quantity!==1)throw Error('共用資料庫測試每筆固定借 1 部。');
   if(!e.class||!e.subject||!e.room||!['basic','interactive'].includes(e.usage_type))throw Error('請填妥班別、科目、地點及用途。');
   const teacher=a.teachers.find(t=>t.name===e.teacher_name);
   if(!teacher||(!a.isAdmin&&!a.names.has(teacher.name)))throw Error('借用老師身份不符。');
   if(!a.isAdmin&&teacher.is_suspended&&(!teacher.suspended_until||e.date<=teacher.suspended_until))throw Error('該老師在此日期仍在停借期。');
   if(seen.has(identity(e)))throw Error('清單包含重複日期及課節。');seen.add(identity(e));
  }
  const key='ipad-preview-request:'+a.user.id+':'+JSON.stringify(normalized);
  let requestId;try{requestId=sessionStorage.getItem(key)}catch(_){}
  requestId=requestId||crypto.randomUUID();try{sessionStorage.setItem(key,requestId)}catch(_){}
  const marker=TAG+' [request:'+requestId+']';
  const first=normalized[0].date,last=normalized.at(-1).date;
  const existing=await readRange(first,last);
  const committed=existing.filter(b=>String(b.remarks||'').startsWith(marker+' ')&&email(b.user_email)===email(a.user.email));
  if(committed.length){
   if(committed.length!==normalized.length||!committed.every(b=>normalized.some(e=>identity(e)===identity(b))))throw Error('發現部分已提交測試記錄，請到總表核對，沒有再次提交。');
   try{sessionStorage.removeItem(key)}catch(_){}return committed;
  }
  const [{data:resources,error:rError},{data:adjusts,error:dError}]=await Promise.all([
   _supabase.from('resources').select('name,total_qty'),
   _supabase.from('daily_adjustments').select('*').gte('date',first).lte('date',last)
  ]);if(rError||dError)throw rError||dError;
  const candidates=[];
  for(const e of normalized){
   const slot=existing.filter(b=>b.date===e.date&&Number(b.lesson)===e.lesson&&b.device_type===e.device_type);
   if(slot.some(b=>!isTestBooking(b)))throw Error(`${e.date} 第 ${e.lesson} 節已有正式 ${e.device_type} 預約，請另選空課節測試。`);
   if(slot.some(b=>b.teacher_name===e.teacher_name&&b.class===e.class))throw Error(`${e.date} 第 ${e.lesson} 節已有相同測試預約，沒有再次新增。`);
   const resource=resources.find(r=>r.name===e.device_type);if(!resource)throw Error('設備種類不存在。');
   const stock=adjusts.find(d=>d.date===e.date&&d.device_type===e.device_type)?.available_qty??resource.total_qty;
   const used=slot.filter(b=>!['waiting','returned'].includes(b.status)).reduce((sum,b)=>sum+Number(b.quantity),0)
    +candidates.filter(b=>b.date===e.date&&b.lesson===e.lesson&&b.device_type===e.device_type&&b.status!=='waiting').reduce((sum,b)=>sum+b.quantity,0);
   const status=used+1>stock?'waiting':'pending';
   candidates.push({...e,status,user_email:a.user.email,remarks:marker+' '+(status==='waiting'?'[候補] ':'')+String(e.remarks||'').slice(0,1000)});
  }
  // A single legacy API bulk INSERT is used. The existing API has no lock/idempotency guarantee.
  // Preflight checks and retry markers do not prove concurrent stock safety; do not promote this as-is.
  const {data,error}=await _supabase.from('bookings').insert(candidates).select('*');
  if(error)throw error;
  try{sessionStorage.removeItem(key)}catch(_){}return data;
 }
 async function checkedTestBooking(id){
  allowWrites();const a=await actor();
  const {data:b,error}=await _supabase.from('bookings').select('*').eq('id',id).single();
  if(error)throw error;if(!isTestBooking(b))throw Error('正式借用記錄在 Preview 只供查閱。');
  if(!a.isAdmin&&!a.names.has(b.teacher_name))throw Error('不能操作其他老師的測試記錄。');
  return {a,b};
 }
 async function removeTest(id){
  const {a,b}=await checkedTestBooking(id);
  if(!a.isAdmin&&!['pending','waiting'].includes(b.status))throw Error('已取還的測試記錄請由管理員處理。');
  const {data,error}=await _supabase.from('bookings').delete().eq('id',id).eq('remarks',b.remarks).eq('status',b.status).select('id');
  if(error)throw error;if(!data.length)throw Error('記錄已變更，請刷新後再試。');
  // Intentionally no queue promotion: it could change unrelated live reservations.
  return data;
 }
 async function setStatus(id,status){
  if(!['borrowed','returned'].includes(status))throw Error('共用資料庫 Preview 只測試已取／歸還。');
  const {a,b}=await checkedTestBooking(id);if(!a.isAdmin)throw Error('只有管理員可更新取還狀態。');
  if(b.status===status)return b;
  if(status==='borrowed'&&!['pending','waiting'].includes(b.status))throw Error('只有待取或候補測試記錄可標記已取。');
  if(status==='returned'&&b.status!=='borrowed')throw Error('請先標記已取，再測試歸還。');
  if(status==='borrowed'){
   const slot=await readRange(b.date,b.date);
   if(slot.some(x=>x.lesson===b.lesson&&x.device_type===b.device_type&&!isTestBooking(x)))throw Error('此課節已有正式記錄，不在 Preview 扶正候補。');
   const [{data:resources,error:rError},{data:adjusts,error:dError}]=await Promise.all([
    _supabase.from('resources').select('name,total_qty'),_supabase.from('daily_adjustments').select('*').eq('date',b.date)
   ]);if(rError||dError)throw rError||dError;
   const stock=adjusts.find(d=>d.device_type===b.device_type)?.available_qty??resources.find(r=>r.name===b.device_type)?.total_qty??0;
   const used=slot.filter(x=>x.id!==b.id&&x.lesson===b.lesson&&x.device_type===b.device_type&&!['waiting','returned'].includes(x.status)).reduce((s,x)=>s+x.quantity,0);
   if(used+b.quantity>stock)throw Error('剩餘庫存不足。');
  }
  const {data,error}=await _supabase.from('bookings').update({status}).eq('id',id).eq('remarks',b.remarks).eq('status',b.status).select('*');
  if(error)throw error;if(!data.length)throw Error('記錄已變更，請刷新後再試。');return data[0];
 }
 window.previewShared={TAG,isTestBooking,writable,loadMine,submitEntries,removeTest,setStatus};
 window.ipadLoadPersonalBookings=loadMine;
 async function refreshViews(){
  if(typeof fetchAndRender==='function'){await fetchAndRender();await fetchMonthlyData();window.previewRefreshPersonal?.()}
  if(typeof loadAdminBookings==='function')await loadAdminBookings();
 }
 async function submitUI(selections){
  if(submitting)return;
  const form=el('bookingForm');if(!form.reportValidity())return;
  if(!confirm(`準備提交 ${selections.length} 筆測試預約，每筆 1 部，會寫入現有 Supabase 並自動加測試標記。確認？`))return;
  submitting=true;[el('submitBtn'),el('batchSubmit')].forEach(b=>b.disabled=true);
  try{
   const common={teacher_name:el('teacherSelect').value,device_type:el('deviceType').value,quantity:Number(el('quantity').value),
    class:el('className').value,subject:el('subject').value,room:el('room').value,usage_type:el('usageType').value,remarks:el('remarks').value};
   const rows=await submitEntries(selections.map(s=>({...common,...s})));
   el('batchResult').textContent=`已建立 ${rows.length} 筆測試預約。標記：${TAG}`;
   previewBatch.splice(0);previewRenderBatch();await refreshViews();
  }catch(error){el('batchResult').textContent='提交未完成確認：'+error.message;alert(error.message)}
  finally{submitting=false;[el('submitBtn'),el('batchSubmit')].forEach(b=>b.disabled=!writable())}
 }
 window.handleFormSubmit=event=>{event.preventDefault();return submitUI([previewPrimarySelection()])};
 window.previewSubmitBatch=()=>submitUI(previewAllSelections());
 window.editQuantity=()=>alert('共用資料庫測試每筆固定 1 部，數量不在此 Preview 修改。');
 window.deleteBooking=async(id,teacher)=>{if(!confirm(`只刪除 ${teacher} 的這筆有標記測試預約？`))return;try{await removeTest(id);await refreshViews()}catch(e){alert(e.message)}};
 window.deleteBookingAdmin=async id=>{if(!confirm('只刪除此筆有標記測試預約？這裡不會自動修改其他候補記錄。'))return;try{await removeTest(id);await refreshViews()}catch(e){alert(e.message)}};
 window.updateBookingStatus=async(id,status)=>{try{await setStatus(id,status);await refreshViews()}catch(e){alert(e.message)}};
 const disabled=event=>{event?.preventDefault?.();alert('共用資料庫 Preview 不修改教師、停借、欠取或庫存設定。');return false};
 ['markAsMissed','toggleTeacherSuspend','promptSuspend','resetMissedCount','addNewTeacher','updateResourcesStock','saveDailyAdjustment','deleteDailyAdjustment'].forEach(name=>window[name]=disabled);
 window.previewHideReminder=()=>el('previewReminder')?.classList.add('hidden');
 window.previewShowReminder=async user=>{
  if(!user?.email||!el('previewReminder'))return;
  try{
   const data=await loadMine();if(typeof currentUser==='undefined'||currentUser?.id!==user.id)return;
   const now=new Date(),monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7)),sunday=new Date(monday);sunday.setDate(sunday.getDate()+6);
   const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   const start=fmt(monday),end=fmt(sunday),list=data.filter(b=>b.date>=start&&b.date<=end);
   el('previewReminderRange').textContent=`${start} 至 ${end}`;const items=el('previewReminderItems');items.replaceChildren();
   const labels={pending:'待取機',borrowed:'已取機',returned:'已歸還',missed:'欠取機',waiting:'候補中'};
   for(const b of list){const p=document.createElement('div');p.className='p-3 bg-slate-50 border rounded-xl';p.textContent=`${b.date}（${WEEKDAY_NAMES[new Date(b.date+'T12:00:00').getDay()]}）｜第 ${b.lesson} 節｜${b.device_type} × ${b.quantity}｜${b.class}｜${labels[b.status]||b.status}`;items.append(p)}
   if(!list.length)items.textContent='本週暫無借用記錄。';el('previewReminder').classList.remove('hidden');
  }catch(e){console.warn('提醒未能載入：',e.message)}
 };
 if(typeof window.updateRemainingPreview==='function'){
  const original=window.updateRemainingPreview;window.updateRemainingPreview=()=>{original();const q=el('quantity');q.value='1';q.min='1';q.max='1';q.readOnly=true};
 }
 document.addEventListener('DOMContentLoaded',()=>{
  const banner=document.createElement('div');banner.className='bg-amber-100 text-amber-950 p-3 text-center text-sm font-bold';
  banner.textContent=`Preview 測試｜共用現有 Supabase｜每筆 1 部｜自動標記 ${TAG}｜正式記錄只供查閱`;
  document.body.prepend(banner);
  if(!writable()){banner.textContent='此 Preview 版本在正式或未核准網址禁止寫入。';[el('submitBtn'),el('batchSubmit')].filter(Boolean).forEach(b=>b.disabled=true)}
  document.querySelectorAll('form[onsubmit="addNewTeacher(event)"],form[onsubmit="updateResourcesStock(event)"],form[onsubmit="saveDailyAdjustment(event)"]').forEach(form=>{form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true)});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')window.previewHideReminder()});
 });
})();
