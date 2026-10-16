// Compatible with existing tables; database/booking-date-rules.sql enforces date and cancellation rules.
// Client preflight checks retain the legacy API's concurrency limits; they are not RLS.
(function(){
 'use strict';
 const el=id=>document.getElementById(id);
 const email=value=>String(value||'').trim().toLowerCase();
 const requestCache=new Map();let submitting=false;
 const labels={pending:'待取機',borrowed:'已取機',returned:'已歸還',missed:'欠取機',waiting:'候補中'};
 async function actor(){
  const {data,error}=await _supabase.auth.getUser();if(error||!data?.user)throw Error('請先登入學校帳號。');
  const [{data:teachers,error:te},{data:admins,error:ae}]=await Promise.all([
   _supabase.from('teachers').select('name,email,is_suspended,suspended_until'),_supabase.from('admins').select('email')
  ]);if(te||ae)throw te||ae;
  const user=data.user,isAdmin=admins.some(a=>email(a.email)===email(user.email));
  const names=new Set(teachers.filter(t=>email(t.email)===email(user.email)).map(t=>t.name));
  if(!isAdmin&&!names.size)throw Error('此帳號未列於教師名單，請聯絡管理員。');
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
 const identity=b=>JSON.stringify([b.date,Number(b.lesson),b.teacher_name,b.device_type,b.class]);
 const receiptMatches=(b,e)=>['date','lesson','teacher_name','device_type','quantity','class','subject','room','usage_type'].every(k=>b[k]===e[k]);
 async function submitEntries(entries){
  const a=await actor();if(!entries.length||entries.length>30)throw Error('每次須提交 1 至 30 筆借用。');
  const normalized=entries.map(e=>({date:String(e.date||''),lesson:Number(e.lesson),teacher_name:String(e.teacher_name||''),device_type:String(e.device_type||''),quantity:Number(e.quantity),class:String(e.class||'').trim(),subject:String(e.subject||'').trim(),room:String(e.room||'').trim(),usage_type:String(e.usage_type||''),remarks:String(e.remarks||'').trim()}))
   .sort((x,y)=>x.date.localeCompare(y.date)||x.lesson-y.lesson);
  const today=window.bookingDateRules.today();
  const seen=new Set();
  for(const e of normalized){
   window.bookingDateRules.assertBookable(e.date);
   const validDate=/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&Number.isFinite(new Date(e.date+'T12:00:00Z').getTime());
   if(!validDate||new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)!==e.date||e.date<today||!Number.isInteger(e.lesson)||e.lesson<1||e.lesson>7)throw Error('請選擇今天或以後的有效日期及課節。');
   if(!Number.isSafeInteger(e.quantity)||e.quantity<=0||e.quantity>2147483647)throw Error('借用數量必須是有效正整數。');
   if(!e.class||!e.subject||!e.room||!['basic','interactive'].includes(e.usage_type))throw Error('請填妥班別、科目、地點及用途。');
   const teacher=a.teachers.find(t=>t.name===e.teacher_name);
   if(!teacher||(!a.isAdmin&&!a.names.has(e.teacher_name)))throw Error('借用老師身份不符。');
   if(!a.isAdmin&&teacher.is_suspended&&(!teacher.suspended_until||e.date<=teacher.suspended_until))throw Error(`${e.date} 仍在該老師的停借期，整批未有提交。`);
   if(seen.has(identity(e)))throw Error('清單包含重複日期及課節。');seen.add(identity(e));
  }
  const key='ipad-booking-request:'+a.user.id+':'+JSON.stringify(normalized);
  let ids=requestCache.get(key);try{ids=ids||JSON.parse(sessionStorage.getItem(key)||'null')}catch(_){}
  if(!Array.isArray(ids)||ids.length!==normalized.length)ids=normalized.map(()=>crypto.randomUUID());
  requestCache.set(key,ids);try{sessionStorage.setItem(key,JSON.stringify(ids))}catch(_){}
  const finish=()=>{requestCache.delete(key);try{sessionStorage.removeItem(key)}catch(_){}};
  const first=normalized[0].date,last=normalized.at(-1).date,existing=await readRange(first,last);
  const committed=existing.filter(b=>ids.includes(b.id));
  if(committed.length){
   if(committed.length!==normalized.length||!ids.every((id,i)=>{const b=committed.find(x=>x.id===id);return b&&email(b.user_email)===email(a.user.email)&&receiptMatches(b,normalized[i])}))throw Error('發現部分已提交或已變更記錄，請先到總表核對，沒有再次新增。');
   finish();return ids.map(id=>committed.find(b=>b.id===id));
  }
  const [{data:resources,error:re},{data:adjusts,error:de}]=await Promise.all([
   _supabase.from('resources').select('name,total_qty'),_supabase.from('daily_adjustments').select('*').gte('date',first).lte('date',last)
  ]);if(re||de)throw re||de;
  const candidates=[];
  for(let i=0;i<normalized.length;i++){
   const e=normalized[i],slot=existing.filter(b=>b.date===e.date&&Number(b.lesson)===e.lesson&&b.device_type===e.device_type);
   if(slot.some(b=>b.teacher_name===e.teacher_name&&b.class===e.class&&['pending','borrowed','waiting'].includes(b.status)))throw Error(`${e.date} 第 ${e.lesson} 節已有相同老師、班別及設備的預約，整批未有新增。`);
   const resource=resources.find(r=>r.name===e.device_type);if(!resource)throw Error('設備種類不存在。');
   const stock=adjusts.find(d=>d.date===e.date&&d.device_type===e.device_type)?.available_qty??resource.total_qty;
   const used=slot.filter(b=>!['waiting','returned'].includes(b.status)).reduce((s,b)=>s+Number(b.quantity),0);
   const status=used+e.quantity>stock?'waiting':'pending';
   candidates.push({...e,id:ids[i],status,user_email:a.user.email,remarks:(status==='waiting'?'[候補] ':'')+e.remarks});
  }
  // One bulk INSERT request. Stable primary keys let a response-lost retry find its own rows.
  // The existing API has no server-side slot lock; other tabs/users may still race preflight.
  const {data,error}=await _supabase.from('bookings').insert(candidates).select('*');
  if(error)throw error;finish();return data;
 }
 async function checkedBooking(id){
  const a=await actor();const {data:b,error}=await _supabase.from('bookings').select('*').eq('id',id).single();
  if(error||!b)throw error||Error('預約不存在或已被取消。');
  if(!a.isAdmin&&!a.names.has(b.teacher_name))throw Error('不能操作其他老師的借用記錄。');
  return {a,b};
 }
 async function setStatus(id,status){
  if(!['borrowed','returned'].includes(status))throw Error('取還狀態不正確。');
  const {a,b}=await checkedBooking(id);if(!a.isAdmin)throw Error('只有管理員可更新取還狀態。');
  if(b.status===status)return b;
  if(status==='borrowed'&&!['pending','waiting'].includes(b.status))throw Error('只有待取或候補記錄可標記已取。');
  if(status==='returned'&&b.status!=='borrowed')throw Error('請先標記已取，再登記歸還。');
  if(status==='borrowed'){
   const [{data:resources,error:re},{data:adjusts,error:de},slot]=await Promise.all([
    _supabase.from('resources').select('name,total_qty'),_supabase.from('daily_adjustments').select('*').eq('date',b.date),readRange(b.date,b.date)
   ]);if(re||de)throw re||de;
   const stock=adjusts.find(d=>d.device_type===b.device_type)?.available_qty??resources.find(r=>r.name===b.device_type)?.total_qty??0;
   const used=slot.filter(x=>x.id!==b.id&&x.lesson===b.lesson&&x.device_type===b.device_type&&!['waiting','returned'].includes(x.status)).reduce((s,x)=>s+Number(x.quantity),0);
   if(used+Number(b.quantity)>stock)throw Error('剩餘庫存不足，不能將這筆候補標記已取。');
  }
  const {data,error}=await _supabase.from('bookings').update({status}).eq('id',id).eq('status',b.status).eq('quantity',b.quantity).select('*');
  if(error)throw error;if(!data.length)throw Error('記錄已變更，請刷新後再試。');return data[0];
 }
 async function cancelBooking(id){
  const {a,b}=await checkedBooking(id);
  window.bookingDateRules.assertCanCancel(b,a.isAdmin);
  const {data,error}=await _supabase.rpc('ipad_cancel_booking_before_day_v1',{p_booking_id:id});
  if(error)throw error;return data;
 }
 window.bookingEnhancements={actor,loadMine,submitEntries,checkedBooking,setStatus,cancelBooking};
 window.ipadLoadPersonalBookings=loadMine;
 if(typeof window.updateRemainingPreview==='function'){
  const original=window.updateRemainingPreview;window.updateRemainingPreview=()=>{
   original();el('quantity').removeAttribute('max');el('quantity').readOnly=false;
   if(!el('quantity').value)el('quantity').value='1';
  };
 }
 async function submitUI(selections,isBatch){
  if(submitting)return;if(!el('bookingForm').reportValidity())return;
  if(!confirm(`確認提交 ${selections.length} 筆借用？庫存不足的預約會列為候補。`))return;
  submitting=true;[el('submitBtn'),el('batchSubmit')].forEach(b=>b.disabled=true);
  try{
   const common={teacher_name:el('teacherSelect').value,device_type:el('deviceType').value,quantity:Number(el('quantity').value),class:el('className').value,subject:el('subject').value,room:el('room').value,usage_type:el('usageType').value,remarks:el('remarks').value};
   const rows=await submitEntries(selections.map(s=>({...common,...s}))),waiting=rows.filter(b=>b.status==='waiting').length;
   const message=`已建立 ${rows.length} 筆借用（待取機 ${rows.length-waiting}，候補 ${waiting}）。`;
   el('batchResult').textContent=message;
   if(window.bookingFeedback)window.bookingFeedback.show({title:waiting===rows.length?'已加入候補':'借用登記成功！',message,kind:waiting===rows.length?'waiting':'success'});else alert(message);
   if(isBatch){previewBatch.splice(0);previewRenderBatch()}
   await fetchAndRender();await fetchMonthlyData();window.previewRefreshPersonal?.();
  }catch(e){const message='提交未完成確認：'+e.message+'。如是網絡中斷，請保留相同內容再試；亦可先到總表核對。';el('batchResult').textContent=message;alert(message)}
  finally{submitting=false;await loadTeachers();el('batchSubmit').disabled=el('submitBtn').disabled}
 }
 window.handleFormSubmit=event=>{event.preventDefault();return submitUI([previewPrimarySelection()],false)};
 window.previewSubmitBatch=()=>submitUI(previewAllSelections(),true);
 if(typeof window.deleteBooking==='function'){
  window.deleteBooking=async(id)=>{try{
   const {a,b}=await checkedBooking(id);window.bookingDateRules.assertCanCancel(b,a.isAdmin);
   if(!confirm(`確定取消 ${b.teacher_name} 的 ${b.date} 借用？釋出庫存會自動分派給同課節候補。`))return;
   const result=await cancelBooking(id);
   alert(`已取消借用。${result.promoted_count?`已為 ${result.promoted_count} 筆候補分配庫存。`:''}`);
   await fetchAndRender();await fetchMonthlyData();window.previewRefreshPersonal?.();
  }catch(e){alert(e.message)}};
 }
 window.editQuantity=async(id)=>{
  try{
   const {a,b}=await checkedBooking(id);if(!['pending','waiting'].includes(b.status))throw Error('此狀態不可修改借用數量。');
   const input=prompt(`修改 ${b.teacher_name} 的借用數量（目前 ${b.quantity} 部）：`,b.quantity);if(input===null)return;
   const quantity=Number(input);if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>2147483647)throw Error('請輸入有效正整數。');
   if(!a.isAdmin&&(b.date<window.bookingDateRules.today()||(b.date===window.bookingDateRules.today()&&quantity<b.quantity)))throw Error('最遲須於借用日前一天取消或減少數量；借用當日不可自行取消。');
   if(b.date>window.bookingDateRules.maxDate&&quantity>b.quantity)throw Error(window.bookingDateRules.message);
   if(b.status!=='waiting'){
    const [{data:resources,error:re},{data:adjusts,error:de},slot]=await Promise.all([
     _supabase.from('resources').select('name,total_qty'),_supabase.from('daily_adjustments').select('*').eq('date',b.date),readRange(b.date,b.date)
    ]);if(re||de)throw re||de;
    const stock=adjusts.find(d=>d.device_type===b.device_type)?.available_qty??resources.find(r=>r.name===b.device_type)?.total_qty??0;
    const used=slot.filter(x=>x.id!==b.id&&x.lesson===b.lesson&&x.device_type===b.device_type&&!['waiting','returned'].includes(x.status)).reduce((s,x)=>s+Number(x.quantity),0);
    if(quantity>stock-used)throw Error('剩餘庫存不足，沒有修改數量。');
   }
   const {data,error}=await _supabase.from('bookings').update({quantity}).eq('id',id).eq('status',b.status).eq('quantity',b.quantity).select('id');
   if(error)throw error;if(!data.length)throw Error('記錄已變更，請刷新後再試。');
   await fetchAndRender();await fetchMonthlyData();window.previewRefreshPersonal?.();
  }catch(e){alert(e.message)}
 };
 // Preserve existing administrative operations, with fresh identity checks at invocation.
 for(const name of ['updateBookingStatus','deleteBookingAdmin','toggleTeacherSuspend','promptSuspend','resetMissedCount','addNewTeacher','updateResourcesStock','saveDailyAdjustment','deleteDailyAdjustment']){
  if(typeof window[name]!=='function')continue;const original=window[name];
  window[name]=async(...args)=>{args[0]?.preventDefault?.();try{if(!(await actor()).isAdmin)throw Error('只有管理員可執行此操作。');return await original(...args)}catch(e){alert(e.message)}};
 }
 if(el('adminBookingsTable'))window.updateBookingStatus=async(id,status)=>{try{await setStatus(id,status);await loadAdminBookings()}catch(e){alert(e.message)}};
 if(typeof window.markAsMissed==='function'){
  const original=window.markAsMissed;window.markAsMissed=async(id,teacher)=>{
   try{const {a,b}=await checkedBooking(id);if(!a.isAdmin)throw Error('只有管理員可標記欠取。');if(!['pending','borrowed'].includes(b.status))throw Error('此預約已處理，不能再次標記欠取。');return await original(id,b.teacher_name)}catch(e){alert(e.message)}
  };
 }
 window.previewHideReminder=()=>el('previewReminder')?.classList.add('hidden');
 window.previewShowReminder=async user=>{
  if(!user?.email||!el('previewReminder'))return;
  try{
   const data=await loadMine();if(typeof currentUser==='undefined'||currentUser?.id!==user.id)return;
   const now=new Date(),monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7)),sunday=new Date(monday);sunday.setDate(sunday.getDate()+6);
   const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,start=fmt(monday),end=fmt(sunday);
   el('previewReminderRange').textContent=`${start} 至 ${end}`;const items=el('previewReminderItems');items.replaceChildren();
   const relevant=data.filter(b=>b.date>=start&&b.date<=end);
   for(const b of relevant){const p=document.createElement('div');p.className='p-3 bg-slate-50 border rounded-xl';p.textContent=`${b.date}（${WEEKDAY_NAMES[new Date(b.date+'T12:00:00').getDay()]}）｜第 ${b.lesson} 節｜${b.device_type} × ${b.quantity}｜${b.class}｜${labels[b.status]||b.status}`;items.append(p)}
   if(!relevant.length)items.textContent='本週暫無借用記錄。';el('previewReminder').classList.remove('hidden');el('previewReminder').querySelector('button').focus();
  }catch(e){console.warn('借用提醒未能載入：',e.message)}
 };
 document.addEventListener('DOMContentLoaded',()=>{
  document.addEventListener('keydown',e=>{if(e.key==='Escape')window.previewHideReminder()});
 });
})();
