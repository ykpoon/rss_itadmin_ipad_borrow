// Batch selection UI. All database operations are handled by booking-enhancements.js.
const previewBatch=[];
function previewPrimarySelection(){
 const date=document.getElementById('selectDate')?.value;
 const lesson=Number(document.getElementById('lessonSelect')?.value);
 return {date,lesson};
}
function previewAllSelections(){
 const original=previewPrimarySelection();
 const validOriginal=original.date&&[1,2,3,4,5,6,7].includes(original.lesson);
 const items=[...(validOriginal?[original]:[]),...previewBatch];
 return items.filter((item,index)=>items.findIndex(other=>other.date===item.date&&other.lesson===item.lesson)===index)
   .sort((a,b)=>a.date.localeCompare(b.date)||a.lesson-b.lesson);
}
function previewRenderBatch(){
 const el=document.getElementById('batchItems');
 el.replaceChildren();
 const primary=previewPrimarySelection();
 const first=document.createElement('div');
 first.className='w-full rounded-lg border border-teal-400 bg-teal-100 text-teal-900 p-2 font-semibold';
 first.textContent=primary.date&&primary.lesson?`✅ 原本借用（自動包括）：${primary.date} 第 ${primary.lesson} 節`:'請先選擇上方查詢日期及借用課節';
 el.append(first);
 const extras=previewBatch.filter(x=>x.date!==primary.date||x.lesson!==primary.lesson);
 extras.forEach(x=>{
  const b=document.createElement('button');b.className='rounded-full border border-teal-300 bg-white px-3 py-2 text-teal-800';
  b.textContent=`${x.date} 第 ${x.lesson} 節 ×`;b.type='button';
  b.setAttribute('aria-label',`移除 ${x.date} 第 ${x.lesson} 節`);
  b.onclick=()=>{const i=previewBatch.findIndex(y=>y.date===x.date&&y.lesson===x.lesson);if(i!==-1)previewBatch.splice(i,1);previewRenderBatch()};
  el.append(b);
 });
 const total=document.createElement('p');total.className='w-full font-bold text-teal-800';
 total.textContent=`批量提交合共 ${previewAllSelections().length} 筆（原本 1 筆＋額外 ${extras.length} 筆）`;
 el.append(total);
}
window.previewAddBatchDate=function(){
 const date=document.getElementById('batchDate').value;
 const lesson=Number(document.getElementById('batchLesson').value);
 const today=getTodayString();
 try{window.bookingDateRules.assertBookable(date)}catch(e){return alert(e.message)}
 if(!date||date<today||![1,2,3,4,5,6,7].includes(lesson))return alert('請選擇今天或以後的有效日期及課節。');
 if(previewAllSelections().some(x=>x.date===date&&x.lesson===lesson))return alert('呢個日期及課節已包括喺批量清單。');
 if(previewAllSelections().length>=30)return alert('每次最多 30 個組合（包括原本一筆）。');
 previewBatch.push({date,lesson});previewRenderBatch();
};

document.addEventListener('DOMContentLoaded',()=>{
 document.getElementById('batchDate').value=window.bookingDateRules.clampDate(getTodayString());
 window.bookingDateRules.updateBounds();
 document.getElementById('batchLesson').value=document.getElementById('lessonSelect').value||'1';
 document.getElementById('selectDate').addEventListener('change',previewRenderBatch);
 document.getElementById('lessonSelect').addEventListener('change',previewRenderBatch);previewRenderBatch();
});
