// Render untrusted database fields as text; callbacks receive values through closures.
(function(){
 const td=(row,text)=>{const cell=document.createElement('td');cell.className='py-3 px-3';cell.textContent=text??'—';row.append(cell);return cell};
 const button=(cell,label,fn,title)=>{const b=document.createElement('button');b.type='button';b.className='booking-action'+(['取消','刪除'].includes(label)?' booking-action--cancel':label==='欠取'?' booking-action--warning':'');b.textContent=label;b.title=title||label;b.addEventListener('click',fn);cell.append(b);return b};
 const statusLabels={pending:'待取機',borrowed:'已取機',returned:'已歸還',missed:'欠取機',waiting:'候補中'};
 const success=(cell,promoted,elapsed=4000)=>{const b=document.createElement('span');b.className='booking-success'+(promoted?' booking-success--promoted':'')+(elapsed<3300?' booking-success-animate':'');const icon=document.createElement('span');icon.className='booking-success-icon';icon.textContent='✓';icon.setAttribute('aria-hidden','true');if(elapsed<3300){b.style.animationDelay=`-${elapsed/1000}s`;icon.style.animationDelay=`-${elapsed/1000}s`}b.append(icon,document.createTextNode(promoted?'候補成功':'借用成功'));cell.append(b)};
 const badge=(cell)=>success(cell,true,0);
 const lastStates=new Map(),highlightSeen=new Map();let renderAccount=null;
 if(document.getElementById('bookingsTableBody')){
  let fitFrame=0;
  const fitDailyList=()=>{
   const body=document.getElementById('bookingsTableBody'),table=body.closest('table'),wrap=table.closest('.daily-booking-scroll');
   if(!wrap||!table.getBoundingClientRect().width)return;
   const rows=[...body.rows];
   if(rows.length<8){wrap.style.maxHeight='';return}
   // Fit eight complete records, including variable-height names/actions and
   // the table header, borders and any horizontal scrollbar.
   const height=rows[7].getBoundingClientRect().bottom-table.getBoundingClientRect().top;
   const chrome=wrap.offsetHeight-wrap.clientHeight;
   wrap.style.maxHeight=Math.ceil(height+chrome)+'px';
  };
  const scheduleFit=()=>{cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(fitDailyList)};
  const dailyLesson=document.getElementById('dailyLessonFilter');
  dailyLesson?.addEventListener('change',()=>renderTable());
  window.addEventListener('resize',scheduleFit);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(scheduleFit).observe(document.getElementById('bookingsTableBody').closest('table'));
  document.fonts?.ready.then(scheduleFit);
  renderTable=()=>{
   const body=document.getElementById('bookingsTableBody'),empty=document.getElementById('emptyMessage');body.replaceChildren();
   const list=currentUser?[...currentBookings]:[];
   const lesson=dailyLesson?.value||'all',visible=list.filter(b=>lesson==='all'||Number(b.lesson)===Number(lesson));
   document.getElementById('recordCount').textContent=lesson==='all'?`共 ${list.length} 筆記錄`:`顯示 ${visible.length} 筆／全日共 ${list.length} 筆`;
   empty.classList.toggle('hidden',visible.length>0);empty.textContent=currentUser?(lesson==='all'?'本日暫無借用記錄':'本日此課節暫無借用記錄'):'請先登入學校帳號，以查看借用清單。';
   const ownNames=new Set(teachersList.filter(t=>(t.email||'').trim().toLowerCase()===(currentUser?.email||'').trim().toLowerCase()).map(t=>t.name));
   list.sort((a,b)=>(a.status==='waiting')-(b.status==='waiting')||a.lesson-b.lesson||String(a.created_at).localeCompare(String(b.created_at)));
   const account=currentUser?.id||currentUser?.email||null;if(account!==renderAccount){lastStates.clear();highlightSeen.clear();renderAccount=account}
   const ranks=new Map(),promotions=[];for(const item of list){
    const promoted=String(item.remarks||'').includes('[候補成功]');
    // Track every lesson so filtering does not suppress a teacher's promotion notice.
    if(promoted&&item.status==='pending'&&lastStates.get(item.id)==='waiting'&&(isCurrentUserAdmin||ownNames.has(item.teacher_name)))promotions.push(item);
    lastStates.set(item.id,item.status);
    if(lesson!=='all'&&Number(item.lesson)!==Number(lesson))continue;
    const row=document.createElement('tr');row.dataset.bookingId=item.id;row.className=promoted&&item.status==='pending'?'booking-row--promoted':'';
    td(row,LESSON_NAMES[item.lesson]||`第 ${item.lesson} 節`).classList.add('booking-lesson');
    const teacher=td(row,''),name=document.createElement('span');name.className='booking-teacher';
    const parts=String(item.teacher_name||'').match(/^(.*?)\s*[（(]([^()（）]+)[）)]\s*$/);name.textContent=parts?parts[1].trim():item.teacher_name;teacher.append(name);
    if(parts){const translated=document.createElement('span');translated.className='booking-secondary';translated.textContent=parts[2];teacher.append(translated)}
    const device=td(row,''),line=document.createElement('div'),type=document.createElement('span'),qty=document.createElement('span'),unit=document.createElement('span');
    line.className='booking-device-line';type.className='booking-device'+(item.device_type==='Mobile'?' booking-device--mobile':'');type.textContent=item.device_type;
    qty.className='booking-quantity';qty.textContent=`× ${item.quantity}`;unit.className='booking-unit';unit.textContent='部';line.append(type,qty,unit);device.append(line);
    const state=document.createElement('span');state.className='booking-state booking-state--'+(Object.prototype.hasOwnProperty.call(statusLabels,item.status)?item.status:'unknown');state.textContent=statusLabels[item.status]||item.status;
    if(item.status==='waiting'){const key=item.lesson+':'+item.device_type;const rank=(ranks.get(key)||0)+1;ranks.set(key,rank);state.textContent=`候補順位 ${rank}`}
    device.append(state);
    if(item.status==='pending'||promoted){const key=item.id+':'+item.status+':'+promoted;if(!highlightSeen.has(key))highlightSeen.set(key,Date.now());success(device,promoted,item.status==='pending'?Date.now()-highlightSeen.get(key):4000)}
    const classCell=td(row,''),className=document.createElement('span'),subject=document.createElement('span');className.className='booking-class';className.textContent=item.class;subject.className='booking-secondary';subject.textContent=item.subject;classCell.append(className,subject);
    td(row,item.room).classList.add('booking-room');const actionCell=td(row,''),actions=document.createElement('div');actions.className='booking-actions';actionCell.append(actions);
    if(isCurrentUserAdmin||ownNames.has(item.teacher_name)){
     if(window.bookingDateRules.canEditQuantity(item,isCurrentUserAdmin))button(actions,'修改',()=>window.editQuantity(item.id,item.device_type,item.lesson,item.quantity,item.teacher_name),'修改借用數量');
     if(window.bookingDateRules.canCancel(item,isCurrentUserAdmin))button(actions,'取消',()=>window.deleteBooking(item.id,item.teacher_name),'取消登記');
     else if(['pending','waiting'].includes(item.status)){const note=document.createElement('span');note.className='booking-readonly';note.textContent='已過修改及取消期限';actions.append(note)}
    }else{actions.textContent='—';actions.classList.add('booking-readonly')}body.append(row);
   }
   scheduleFit();
   if(promotions.length)window.bookingFeedback?.show({title:'候補成功！',message:promotions.map(b=>`${b.teacher_name} · 第 ${b.lesson} 節 ${b.device_type} ${b.quantity} 部已成功補上。`).join('\n')});
  };
  renderFrontTeachersTable=()=>{
   const body=document.getElementById('frontTeachersTableBody');if(!body)return;body.replaceChildren();
   if(!currentUser){const row=document.createElement('tr');const cell=td(row,'請先登入後查看教師名單。');cell.colSpan=4;body.append(row);return}
   const badge=document.getElementById('frontSuspendedCount');if(badge)badge.textContent=`${teachersList.filter(t=>t.is_suspended).length} 位停借中`;
   for(const t of [...teachersList].sort((a,b)=>Number(b.is_suspended)-Number(a.is_suspended)||b.missed_count-a.missed_count)){
    const row=document.createElement('tr');td(row,t.name);td(row,`${t.missed_count||0} 次`);td(row,t.is_suspended?'暫停借用中':'正常');td(row,window.schoolDates.format(t.suspended_until)||'—');body.append(row);
   }
  };
 }
 if(document.getElementById('adminBookingsTable')){
  let adminRows=[],adminLoadVersion=0,adminLoading=false,adminError=null;
  const search=document.getElementById('adminBookingSearch');
  const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  const matchesSearch=(item,terms)=>{
   const machine=item.usage_type==='basic'?'普通機':item.usage_type==='interactive'?'較高性能機 性能較好':'';
   const text=[item.teacher_name,LESSON_NAMES[item.lesson],`第${item.lesson}節`,item.device_type,item.device_type==='Mobile'?'手機':'',item.quantity,item.class,item.subject,item.room,item.user_email,item.remarks,item.usage_type,machine,statusLabels[item.status],item.status==='borrowed'?'借出中 已借出':''].map(normalized).join('\n');
   return terms.every(term=>{const lesson=term.match(/^(?:第)?([1-7])節$/);return lesson?Number(item.lesson)===Number(lesson[1]):text.includes(term)});
  };
  const renderAdminBookings=()=>{
   const body=document.getElementById('adminBookingsTable');body.replaceChildren();
   const terms=String(search?.value||'').normalize('NFKC').trim().replace(/第\s*([1-7])\s*節/g,'第$1節').split(/\s+/).filter(Boolean).map(normalized);
   const list=adminRows.filter(item=>matchesSearch(item,terms));updateStatusCounters(list);
   document.getElementById('adminEmptyBookings')?.classList.add('hidden');
   const count=document.getElementById('adminSearchCount');if(count)count.textContent=adminLoading?'正在載入…':adminError?'未能載入記錄。':`顯示 ${list.length} 筆／當日共 ${adminRows.length} 筆`;
   if(adminLoading||adminError||!list.length){const row=document.createElement('tr');const message=adminLoading?'正在載入…':adminError?'未能載入：'+adminError:adminRows.length?'沒有符合搜尋條件的記錄。':'當日沒有借用記錄。';const cell=td(row,message);cell.colSpan=8;body.append(row);return}
   for(const item of list){const row=document.createElement('tr');row.dataset.bookingId=item.id;
    td(row,LESSON_NAMES[item.lesson]);td(row,item.teacher_name);td(row,`${item.device_type} × ${item.quantity}`);
    td(row,`${item.class} · ${item.subject} (${item.room})`);td(row,item.user_email);td(row,String(item.remarks||'').replace('[候補成功]','').replace('[候補]','').trim()||'—');const status=td(row,statusLabels[item.status]||item.status);
    if(String(item.remarks||'').includes('[候補成功]'))badge(status,'🎉 候補成功');
    const actions=td(row,'');if(['pending','waiting'].includes(item.status))button(actions,'已取',()=>window.updateBookingStatus(item.id,'borrowed'));
    if(item.status==='borrowed')button(actions,'歸還',()=>window.updateBookingStatus(item.id,'returned'));
    if(['pending','borrowed'].includes(item.status))button(actions,'欠取',()=>window.markAsMissed(item.id,item.teacher_name));button(actions,'刪除',()=>window.deleteBookingAdmin(item.id));body.append(row);
   }
  };
  search?.addEventListener('input',renderAdminBookings);
  document.getElementById('adminBookingSearchClear')?.addEventListener('click',()=>{search.value='';renderAdminBookings();search.focus()});
  loadAdminBookings=async()=>{
   const version=++adminLoadVersion,date=document.getElementById('adminQueryDate').value;
   adminRows=[];adminError=null;adminLoading=true;renderAdminBookings();
   try{
    const {data,error}=await _supabase.from('bookings').select('*').eq('date',date).order('lesson');
    if(version!==adminLoadVersion||document.getElementById('adminQueryDate').value!==date)return;
    adminRows=error?[]:data||[];adminError=error?.message||null;
   }catch(error){if(version!==adminLoadVersion)return;adminError=error.message||'請稍後再試。'}
   adminLoading=false;renderAdminBookings();
  };window.loadAdminBookings=loadAdminBookings;
  loadAdminTeachers=async()=>{
   const {data,error}=await _supabase.from('teachers').select('*');
   const body=document.getElementById('adminTeachersTable');body.replaceChildren();
   if(error)return;
   document.getElementById('suspendedCount').textContent=`${data.filter(t=>t.is_suspended).length} 位停借中`;
   for(const t of data.sort((a,b)=>a.name.localeCompare(b.name))){const row=document.createElement('tr');
    td(row,`${t.name}\n${t.email||'未設定電郵'}`);td(row,`${t.missed_count||0} 次`);td(row,t.is_suspended?'暫停借用中':'正常');td(row,window.schoolDates.format(t.suspended_until)||'—');
    const actions=td(row,'');button(actions,t.is_suspended?'解除停借':'設為停借',()=>t.is_suspended?window.toggleTeacherSuspend(t.name,false):window.promptSuspend(t.name));
    button(actions,'清零',()=>window.resetMissedCount(t.name));body.append(row);
   }
  };window.loadAdminTeachers=loadAdminTeachers;
  loadDailyAdjustments=async()=>{
   const {data,error}=await _supabase.from('daily_adjustments').select('*').order('date');
   const body=document.getElementById('dailyAdjustmentsTable');body.replaceChildren();
   if(error||!data.length){const row=document.createElement('tr');td(row,error?'未能載入調節記錄':'暫無特別日期調節').colSpan=5;body.append(row);return}
   for(const t of data){const row=document.createElement('tr');td(row,window.schoolDates.format(t.date));td(row,t.device_type);td(row,`${t.available_qty} 部`);td(row,t.reason);button(td(row,''),'還原',()=>window.deleteDailyAdjustment(t.id));body.append(row)}
  };window.loadDailyAdjustments=loadDailyAdjustments;
 }
})();
