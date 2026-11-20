// Shared school-date rules. The database enforces the same limits for browser API requests.
(function(){
 const LEGACY_LAST_DATE='2026-12-31', ADVANCE_DAYS=14;
 const message='此借用日期暫未開放。2027 年起，最早可於借用日前 14 天預約（香港時間）。';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
 const lastDate=()=>{const rolling=addDays(today(),ADVANCE_DAYS);return rolling>LEGACY_LAST_DATE?rolling:LEGACY_LAST_DATE};
 const clampDate=date=>{const max=lastDate();return date>max?max:date};
 const openingDate=date=>addDays(date,-ADVANCE_DAYS);
 const latestMonth=()=>{const [year,month]=lastDate().split('-').map(Number);return new Date(year,month-1,1)};
 function clampMonth(date){const month=new Date(date.getFullYear(),date.getMonth(),1);return month>latestMonth()?latestMonth():month}
 function assertBookable(date){if(date>lastDate())throw Error(message)}
 function canCancel(booking,isAdmin=false){return isAdmin||(booking.date>today()&&['pending','waiting'].includes(booking.status))}
 function canEditQuantity(booking,isAdmin=false){return ['pending','waiting'].includes(booking.status)&&(isAdmin||booking.date>today())}
 function assertCanEditQuantity(booking,isAdmin=false){if(!canEditQuantity(booking,isAdmin))throw Error('已過修改及取消期限，請聯絡管理員。')}
 function assertCanCancel(booking,isAdmin=false){if(!canCancel(booking,isAdmin))throw Error('最遲須於借用日前一天取消；借用當日不可自行取消，請聯絡管理員。')}
 function updateBounds(){
  const max=lastDate();
  ['selectDate','dashboard-date-picker','batchDate'].forEach(id=>{const input=document.getElementById(id);if(input){if(input.max!==max)input.max=max;if(input.value>max)input.value=max}});
  const batch=document.getElementById('batchDate'),min=today();if(batch&&batch.min!==min)batch.min=min;
  const selected=document.getElementById('selectDate');const next=document.getElementById('dashboard-next-day');if(next&&selected)next.disabled=selected.value>=max;
  const monthNext=document.getElementById('calendar-next-month');if(monthNext&&typeof calendarDate!=='undefined')monthNext.disabled=calendarDate>=latestMonth();
 }
 window.bookingDateRules=Object.freeze({get maxDate(){return lastDate()},message,today,openingDate,clampDate,latestMonth,clampMonth,assertBookable,canCancel,assertCanCancel,canEditQuantity,assertCanEditQuantity,updateBounds});
 document.addEventListener('DOMContentLoaded',()=>{
  updateBounds();let previousDay=today();
  const refreshDay=()=>{const day=today();if(day!==previousDay){previousDay=day;updateBounds();if(typeof renderTable==='function')renderTable();if(typeof renderCalendar==='function')renderCalendar();window.dispatchEvent(new Event('ipad:school-day-changed'))}};
  setInterval(refreshDay,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay()});
  window.addEventListener('focus',refreshDay);
 });
})();
