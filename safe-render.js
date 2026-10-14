// Render untrusted database fields as text; callbacks receive values through closures.
(function(){
 const td=(row,text)=>{const cell=document.createElement('td');cell.className='py-3 px-3';cell.textContent=text??'—';row.append(cell);return cell};
 const button=(cell,label,fn,title)=>{const b=document.createElement('button');b.type='button';b.className='px-2 py-1 rounded border text-teal-700 bg-teal-50 m-1';b.textContent=label;b.title=title||label;b.addEventListener('click',fn);cell.append(b);return b};
 const statusLabels={pending:'待取機',borrowed:'已取機',returned:'已歸還',missed:'欠取機',waiting:'候補中'};
 const badge=(cell,text,waiting=false)=>{const b=document.createElement('span');b.className='block mt-1 text-xs font-bold '+(waiting?'text-amber-700':'text-teal-700');b.textContent=text;cell.append(b)};
 if(document.getElementById('bookingsTableBody')){
  renderTable=()=>{
   const body=document.getElementById('bookingsTableBody'),empty=document.getElementById('emptyMessage');body.replaceChildren();
   const list=currentUser?[...currentBookings]:[];
   document.getElementById('recordCount').textContent=`共 ${list.length} 筆記錄`;
   empty.classList.toggle('hidden',list.length>0);empty.textContent=currentUser?'本日暫無借用記錄':'請先登入學校帳號，以查看借用清單。';
   const ownNames=new Set(teachersList.filter(t=>(t.email||'').trim().toLowerCase()===(currentUser?.email||'').trim().toLowerCase()).map(t=>t.name));
   list.sort((a,b)=>(a.status==='waiting')-(b.status==='waiting')||a.lesson-b.lesson||String(a.created_at).localeCompare(String(b.created_at)));
   const ranks=new Map();for(const item of list){
    const row=document.createElement('tr');row.dataset.bookingId=item.id;
    td(row,LESSON_NAMES[item.lesson]);td(row,item.teacher_name);
    const device=td(row,`${item.device_type} × ${item.quantity} · ${statusLabels[item.status]||item.status}`);
    if(item.status==='waiting'){const key=item.lesson+':'+item.device_type;const rank=(ranks.get(key)||0)+1;ranks.set(key,rank);badge(device,`候補順位 ${rank}`,true)}
    if(String(item.remarks||'').includes('[候補成功]'))badge(device,'🎉 候補成功');
    td(row,`${item.class} (${item.subject})`);td(row,item.room);const actions=td(row,'');
    if(isCurrentUserAdmin||ownNames.has(item.teacher_name)){
     if(['pending','waiting'].includes(item.status))button(actions,'修改',()=>window.editQuantity(item.id,item.device_type,item.lesson,item.quantity,item.teacher_name),'修改借用數量');
     if(isCurrentUserAdmin||['pending','waiting'].includes(item.status))button(actions,'取消',()=>window.deleteBooking(item.id,item.teacher_name),'取消登記');
    }else actions.textContent='—';body.append(row);
   }
  };
  renderFrontTeachersTable=()=>{
   const body=document.getElementById('frontTeachersTableBody');if(!body)return;body.replaceChildren();
   if(!currentUser){const row=document.createElement('tr');const cell=td(row,'請先登入後查看教師名單。');cell.colSpan=4;body.append(row);return}
   const badge=document.getElementById('frontSuspendedCount');if(badge)badge.textContent=`${teachersList.filter(t=>t.is_suspended).length} 位停借中`;
   for(const t of [...teachersList].sort((a,b)=>Number(b.is_suspended)-Number(a.is_suspended)||b.missed_count-a.missed_count)){
    const row=document.createElement('tr');td(row,t.name);td(row,`${t.missed_count||0} 次`);td(row,t.is_suspended?'暫停借用中':'正常');td(row,t.suspended_until||'—');body.append(row);
   }
  };
 }
 if(document.getElementById('adminBookingsTable')){
  loadAdminBookings=async()=>{
   const date=document.getElementById('adminQueryDate').value;
   const {data,error}=await _supabase.from('bookings').select('*').eq('date',date).order('lesson');
   const body=document.getElementById('adminBookingsTable');body.replaceChildren();
   const list=data||[];updateStatusCounters(list);
   if(error||!list.length){const row=document.createElement('tr');const cell=td(row,error?'未能載入：'+error.message:'當日沒有借用記錄。');cell.colSpan=8;body.append(row);return}
   for(const item of list){const row=document.createElement('tr');row.dataset.bookingId=item.id;
    td(row,LESSON_NAMES[item.lesson]);td(row,item.teacher_name);td(row,`${item.device_type} × ${item.quantity}`);
    td(row,`${item.class} · ${item.subject} (${item.room})`);td(row,item.user_email);td(row,String(item.remarks||'').replace('[候補成功]','').replace('[候補]','').trim()||'—');const status=td(row,statusLabels[item.status]||item.status);
    if(String(item.remarks||'').includes('[候補成功]'))badge(status,'🎉 候補成功');
    const actions=td(row,'');if(['pending','waiting'].includes(item.status))button(actions,'已取',()=>window.updateBookingStatus(item.id,'borrowed'));
    if(item.status==='borrowed')button(actions,'歸還',()=>window.updateBookingStatus(item.id,'returned'));
    if(['pending','borrowed'].includes(item.status))button(actions,'欠取',()=>window.markAsMissed(item.id,item.teacher_name));button(actions,'刪除',()=>window.deleteBookingAdmin(item.id));body.append(row);
   }
  };window.loadAdminBookings=loadAdminBookings;
  loadAdminTeachers=async()=>{
   const {data,error}=await _supabase.from('teachers').select('*');
   const body=document.getElementById('adminTeachersTable');body.replaceChildren();
   if(error)return;
   document.getElementById('suspendedCount').textContent=`${data.filter(t=>t.is_suspended).length} 位停借中`;
   for(const t of data.sort((a,b)=>a.name.localeCompare(b.name))){const row=document.createElement('tr');
    td(row,`${t.name}\n${t.email||'未設定電郵'}`);td(row,`${t.missed_count||0} 次`);td(row,t.is_suspended?'暫停借用中':'正常');td(row,t.suspended_until||'—');
    const actions=td(row,'');button(actions,t.is_suspended?'解除停借':'設為停借',()=>t.is_suspended?window.toggleTeacherSuspend(t.name,false):window.promptSuspend(t.name));
    button(actions,'清零',()=>window.resetMissedCount(t.name));body.append(row);
   }
  };window.loadAdminTeachers=loadAdminTeachers;
  loadDailyAdjustments=async()=>{
   const {data,error}=await _supabase.from('daily_adjustments').select('*').order('date');
   const body=document.getElementById('dailyAdjustmentsTable');body.replaceChildren();
   if(error||!data.length){const row=document.createElement('tr');td(row,error?'未能載入調節記錄':'暫無特別日期調節').colSpan=5;body.append(row);return}
   for(const t of data){const row=document.createElement('tr');td(row,t.date);td(row,t.device_type);td(row,`${t.available_qty} 部`);td(row,t.reason);button(td(row,''),'還原',()=>window.deleteDailyAdjustment(t.id));body.append(row)}
  };window.loadDailyAdjustments=loadDailyAdjustments;
 }
})();
