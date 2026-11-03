// Real front/admin pages with in-memory API fixtures; never writes to production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
 try{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root))throw Error();const content=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(content)}catch{res.writeHead(404);res.end()}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.IPAD_CHROMIUM_EXECUTABLE?{executablePath:process.env.IPAD_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote']});
const errors=[];
async function createPage(admin=false,timezoneId='Asia/Hong_Kong'){
 const page=await browser.newPage({viewport:{width:1024,height:1366},timezoneId});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 if(admin)await page.addInitScript(()=>localStorage.setItem('reminder-test-user','admin'));
 await page.addInitScript({path:path.join(root,'tests/fixtures/reminder-browser.js')});
 await page.addInitScript(()=>{
  const db=reminderTestDB;db.teachers[0].name='Chan Ka Ming (陳家明)';db.teachers[2].name='Lee Wai Yan (李慧欣)';
  db.bookings=Array.from({length:42},(_,i)=>({id:'day-'+i,date:'2026-11-03',lesson:Math.floor(i/6)+1,teacher_name:db.teachers[i%3].name,device_type:i%2?'Mobile':'iPad',quantity:10+i%4,class:(i%6+1)+'A',subject:i%2?'中文':'ICT',room:i%2?'圖書館':'Room 1',status:i===2?'waiting':i===5?'missed':i===12?'borrowed':i===14?'returned':'pending',usage_type:i%2?'basic':'interactive',created_at:'2026-10-20T00:00:00Z',user_email:i%3===0?'a@example.invalid':'admin@example.invalid',remarks:i===0?'<img src=x onerror=window.badFilter=true>':''}));
  for(const [id,date] of [['previous','2026-11-02'],['next-week','2026-11-09'],['future','2026-11-12']])db.bookings.push({...db.bookings[0],id,date,remarks:''});
 });
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.fulfill({contentType:route.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''}));
 await page.clock.setFixedTime(new Date('2026-11-03T04:00:00Z'));
 return page;
}
const pass=s=>console.log('PASS',s);
const front=await createPage(),admin=await createPage(true);
try{
 await front.goto(origin);await front.waitForFunction(()=>document.querySelectorAll('#bookingsTableBody tr').length===42);
 await front.addStyleTag({content:'.hidden{display:none!important}*{box-sizing:border-box}'});
 if(process.env.LIST_TEST_FONT){const font=(await readFile(process.env.LIST_TEST_FONT)).toString('base64');await front.addStyleTag({content:`@font-face{font-family:ListQA;src:url(data:font/otf;base64,${font})}#bookingsTableBody{font-family:ListQA,sans-serif}`});await front.evaluate(()=>document.fonts.load('14px ListQA','借用老師課節'))}
 await front.evaluate(()=>previewHideReminder());
 await front.waitForFunction(()=>document.querySelector('.daily-booking-scroll').style.maxHeight);
 async function checkEight(){
  await front.waitForTimeout(70);
  const bounds=await front.evaluate(()=>{
   const wrap=document.querySelector('.daily-booking-scroll');wrap.scrollTop=0;const rows=[...document.querySelectorAll('#bookingsTableBody tr')];const limit=wrap.getBoundingClientRect().top+wrap.clientTop+wrap.clientHeight;
   return {eighth:rows[7].getBoundingClientRect().bottom,ninth:rows[8].getBoundingClientRect().bottom,limit,scrollable:wrap.scrollHeight>wrap.clientHeight};
  });
  assert.ok(bounds.eighth<=bounds.limit+2,JSON.stringify(bounds));assert.ok(bounds.ninth>bounds.limit+8,JSON.stringify(bounds));assert.ok(bounds.scrollable);
 }
 await checkEight();await front.setViewportSize({width:390,height:844});await checkEight();await front.setViewportSize({width:1024,height:1366});
 assert.equal(await front.locator('[data-mode]').count(),0);pass('Original table preserved; eight complete variable-height records fit on iPad/mobile before scrolling');
 const before=await front.evaluate(()=>reminderTestReads);
 await front.selectOption('#dailyLessonFilter','3');assert.equal(await front.locator('#bookingsTableBody tr').count(),6);assert.match(await front.locator('#recordCount').innerText(),/6 筆.*42 筆/);
 assert.ok((await front.locator('#bookingsTableBody').innerText()).includes('第 3 節'));
 assert.equal(await front.evaluate(()=>reminderTestReads),before);
 await front.evaluate(()=>{reminderTestDB.bookings=reminderTestDB.bookings.filter(b=>b.lesson!==7);return fetchAndRender()});
 await front.selectOption('#dailyLessonFilter','7');assert.equal(await front.locator('#bookingsTableBody tr').count(),0);assert.match(await front.locator('#emptyMessage').innerText(),/此課節/);
 await front.selectOption('#dailyLessonFilter','all');assert.equal(await front.locator('#bookingsTableBody tr').count(),36);
 pass('Lesson filtering updates counts locally, preserves all-day data, and handles an empty lesson');

 await front.evaluate(()=>{document.getElementById('personal-section').classList.remove('hidden');return previewRefreshPersonal()});
 assert.equal(await front.locator('#personal-range').inputValue(),'week');assert.equal(await front.locator('#personal-start').inputValue(),'2026-11-02');assert.equal(await front.locator('#personal-end').inputValue(),'2026-11-08');
 assert.equal(await front.locator('#personal-rows tr[data-booking-id="future"]').count(),0);
 assert.equal(await front.locator('#personal-rows tr[data-booking-id="next-week"]').count(),0);
 await front.selectOption('#personal-range','all');assert.equal(await front.locator('#personal-rows tr[data-booking-id="future"]').count(),1);
 await front.click('#personal-reset');assert.equal(await front.locator('#personal-range').inputValue(),'week');assert.equal(await front.locator('#personal-rows tr[data-booking-id="future"]').count(),0);
 pass('Personal summary defaults and resets to this week; all dates remain available');

 await admin.goto(origin+'/admin.html');await admin.addStyleTag({content:'.hidden{display:none!important}'});await admin.waitForFunction(()=>document.querySelectorAll('#adminBookingsTable tr[data-booking-id]').length===42);
 const search=admin.locator('#adminBookingSearch'),rows=admin.locator('#adminBookingsTable tr[data-booking-id]');
 const reads=await admin.evaluate(()=>reminderTestReads);
 await search.fill('陳家明 第 3 節');assert.equal(await rows.count(),2);assert.match(await admin.locator('#adminSearchCount').innerText(),/2 筆.*42 筆/);assert.equal(await admin.locator('#countPending').innerText(),'1');assert.equal(await admin.locator('#countBorrowed').innerText(),'1');
 await search.fill('CHAN KA MING');assert.equal(await rows.count(),14);
 await search.fill('手機 第1節');assert.equal(await rows.count(),3);
 await search.fill('1A ICT Room 1');assert.equal(await rows.count(),7);
 await search.fill('候補');assert.equal(await rows.count(),1);
 await search.fill('不存在的老師');assert.equal(await rows.count(),0);assert.match(await admin.locator('#adminBookingsTable').innerText(),/沒有符合搜尋條件/);
 await search.fill('<img');assert.equal(await rows.count(),1);assert.equal(await admin.locator('#adminBookingsTable img').count(),0);
 assert.equal(await admin.evaluate(()=>reminderTestReads),reads);
 await admin.click('#adminBookingSearchClear');assert.equal(await rows.count(),42);
 await admin.setViewportSize({width:390,height:844});const field=await search.boundingBox();assert.ok(field.x>=0&&field.x+field.width<=390);await admin.setViewportSize({width:1024,height:1366});
 pass('Admin search supports Chinese/English teacher names, lesson phrases, combined terms, fields/status, counts and safe empty results without extra API requests');

 await search.fill('陳家明 第1節');
 await admin.evaluate(()=>{window.listTestActions=[];window.updateBookingStatus=async(id,status)=>{listTestActions.push({id,status});reminderTestDB.bookings.find(b=>b.id===id).status=status;await loadAdminBookings()}});
 await rows.first().getByRole('button',{name:'已取',exact:true}).click();await admin.waitForFunction(()=>document.getElementById('adminSearchCount').textContent.includes('當日共'));
 assert.equal(await search.inputValue(),'陳家明 第1節');assert.equal(await rows.count(),2);assert.deepEqual(await admin.evaluate(()=>listTestActions),[{id:'day-0',status:'borrowed'}]);
 pass('Filtered action targets the original booking ID and retains the search after refresh');

 await admin.evaluate(()=>{listTestDelayByDate={'2026-11-02':180};document.getElementById('adminQueryDate').value='2026-11-02';void loadAdminBookings();document.getElementById('adminQueryDate').value='2026-11-12';void loadAdminBookings()});
 await admin.waitForTimeout(250);assert.match(await admin.locator('#adminSearchCount').innerText(),/當日共 1 筆/);assert.equal(await rows.first().getAttribute('data-booking-id'),'future');
 await admin.evaluate(()=>{listTestFailBookings=true;return loadAdminBookings()});assert.match(await admin.locator('#adminBookingsTable').innerText(),/測試載入失敗/);assert.equal(await rows.count(),0);
 await admin.evaluate(()=>{listTestFailBookings=false;return loadAdminBookings()});assert.equal(await rows.count(),1);
 pass('Changing dates ignores stale responses; failed loads clear old results and recover');

 const remote=await createPage(false,'America/Los_Angeles');await remote.clock.setFixedTime(new Date('2026-11-02T00:30:00Z'));await remote.goto(origin);await remote.waitForSelector('#personal-start',{state:'attached'});
 assert.equal(await remote.locator('#personal-start').inputValue(),'2026-11-02');assert.equal(await remote.locator('#personal-end').inputValue(),'2026-11-08');
 await remote.clock.setFixedTime(new Date('2026-11-09T00:30:00Z'));await remote.evaluate(()=>window.dispatchEvent(new Event('ipad:school-day-changed')));assert.equal(await remote.locator('#personal-start').inputValue(),'2026-11-09');await remote.close();
 assert.deepEqual(errors,[]);pass('Default week follows Hong Kong time and updates at a new school week; no browser errors');
}finally{await browser.close();await new Promise(done=>server.close(done))}
