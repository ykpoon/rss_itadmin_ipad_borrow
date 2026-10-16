// Shared school-date rules. The database enforces the same limits for browser API requests.
(function(){
 const MAX_DATE='2026-12-31';
 const message='2027 年 1 月或之後的借用暫未開放，目前只可借用至 2026 年 12 月 31 日。';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const clampDate=date=>date>MAX_DATE?MAX_DATE:date;
 const latestMonth=()=>new Date(2026,11,1);
 function clampMonth(date){const month=new Date(date.getFullYear(),date.getMonth(),1);return month>latestMonth()?latestMonth():month}
 function assertBookable(date){if(date>MAX_DATE)throw Error(message)}
 function canCancel(booking,isAdmin=false){return isAdmin||(booking.date>today()&&['pending','waiting'].includes(booking.status))}
 function assertCanCancel(booking,isAdmin=false){if(!canCancel(booking,isAdmin))throw Error('最遲須於借用日前一天取消；借用當日不可自行取消，請聯絡管理員。')}
 function updateBounds(){
  ['selectDate','dashboard-date-picker','batchDate'].forEach(id=>{const input=document.getElementById(id);if(input){input.max=MAX_DATE;if(input.value>MAX_DATE)input.value=MAX_DATE}});
  const batch=document.getElementById('batchDate');if(batch)batch.min=today();
  const selected=document.getElementById('selectDate');const next=document.getElementById('dashboard-next-day');if(next&&selected)next.disabled=selected.value>=MAX_DATE;
  const monthNext=document.getElementById('calendar-next-month');if(monthNext&&typeof calendarDate!=='undefined')monthNext.disabled=calendarDate.getFullYear()===2026&&calendarDate.getMonth()===11;
 }
 window.bookingDateRules=Object.freeze({maxDate:MAX_DATE,message,today,clampDate,latestMonth,clampMonth,assertBookable,canCancel,assertCanCancel,updateBounds});
 document.addEventListener('DOMContentLoaded',()=>{
  updateBounds();let previousDay=today();
  setInterval(()=>{const day=today();if(day!==previousDay){previousDay=day;updateBounds();if(typeof renderTable==='function')renderTable()}},30000);
 });
})();
