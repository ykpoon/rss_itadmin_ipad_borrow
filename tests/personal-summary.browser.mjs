// Run with playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs.
// Scope: real summary DOM + real guarded action handlers + isolated in-memory API fixtures.
import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.IPAD_CHROMIUM_EXECUTABLE?{executablePath:process.env.IPAD_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote']});
const page=await browser.newPage({viewport:{width:1024,height:1366}});const errors=[],alerts=[];
page.on('pageerror',e=>errors.push(e.message));
const pass=s=>console.log('PASS',s);
let promptAnswer='12',confirmation=true;
page.on('dialog',async dialog=>{
 if(dialog.type()==='prompt')return promptAnswer===null?dialog.dismiss():dialog.accept(promptAnswer);
 if(dialog.type()==='confirm')return confirmation?dialog.accept():dialog.dismiss();
 alerts.push(dialog.message());await dialog.accept();
});
const row=id=>page.locator(`#personal-rows tr[data-booking-id="${id}"]`);
async function settled(){await page.waitForFunction(()=>!document.querySelector('#personal-message').textContent.includes('正在載入')&&[...document.querySelectorAll('#personal-rows button')].every(b=>!b.disabled))}
try{
 await page.clock.setFixedTime(new Date('2026-10-29T04:00:00Z'));
 await page.setContent('<!doctype html><html lang="zh-HK"><head><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}main{max-width:1200px;margin:auto}.hidden{display:none}</style></head><body><main></main></body></html>');
 for(const file of ['fixtures/personal-summary-browser.js','../booking-date-rules.js','../booking-enhancements.js','../personal-summary.js'])await page.addScriptTag({path:fileURLToPath(new URL(file,import.meta.url))});
 await page.evaluate(()=>{document.dispatchEvent(new Event('DOMContentLoaded'));document.getElementById('personal-section').classList.remove('hidden');return previewRefreshPersonal()});await settled();
 assert.equal(await page.locator('#personal-rows tr').count(),7);assert.equal(await row('other').count(),0);assert.equal(await row('alias').count(),1);
 assert.match(await row('future').innerText(),/普通機/);assert.match(await row('wait').innerText(),/較高性能機/);assert.match(await row('unknown').innerText(),/未註明/);assert.equal(await row('unknown').locator('img').count(),0);
 for(const id of ['future','wait','alias']){assert.equal(await row(id).getByRole('button',{name:'修改數量',exact:true}).count(),1);assert.equal(await row(id).getByRole('button',{name:'取消借用',exact:true}).count(),1)}
 assert.equal(await row('today').getByRole('button',{name:'取消借用',exact:true}).count(),0);for(const id of ['past','returned'])assert.equal(await row(id).getByRole('button').count(),0);
 pass('本人、同電郵別名及代登記顯示正確，機種及狀態期限按鈕正確，文字安全呈現');
 const actions=await row('future').locator('.personal-actions').boundingBox();assert.ok(actions.x+actions.width<=1025);assert.ok(actions.width>=166);
 assert.ok(await row('future').getByRole('button',{name:'修改數量'}).evaluate(e=>e.getBoundingClientRect().height>=44));
 pass('iPad操作欄固定可見，按鈕觸控高度至少44px');
 await page.selectOption('#personal-status','pending');await page.fill('#personal-start','2026-10-30');await page.dispatchEvent('#personal-start','change');
 await row('future').getByRole('button',{name:'修改數量',exact:true}).click();await page.waitForFunction(()=>testDB.bookings.find(b=>b.id==='future').quantity===12);await settled();
 assert.match(await row('future').innerText(),/12 部/);assert.equal(await page.locator('#personal-status').inputValue(),'pending');assert.equal(await page.locator('#personal-start').inputValue(),'2026-10-30');
 pass('總表直接修改數量並更新畫面，保留篩選及所在分頁');
 confirmation=false;await row('future').getByRole('button',{name:'取消借用',exact:true}).click();await settled();assert.equal(await row('future').count(),1);assert.equal(await page.evaluate(()=>testWrites.filter(w=>w.operation==='rpc').length),0);
 confirmation=true;await page.evaluate(()=>failCancel=true);await row('future').getByRole('button',{name:'取消借用',exact:true}).click();await settled();assert.equal(await row('future').count(),1);assert.match(alerts.at(-1),/網絡錯誤/);
 await page.evaluate(()=>failCancel=false);await row('future').getByRole('button',{name:'取消借用',exact:true}).click();await page.waitForFunction(()=>!testDB.bookings.some(b=>b.id==='future'));await settled();assert.equal(await row('future').count(),0);assert.equal(await page.evaluate(()=>testWrites.filter(w=>w.operation==='rpc')[0].name),'ipad_cancel_booking_before_day_v1');
 assert.equal(await page.locator('[data-status="all"]').textContent(),'6');
 pass('取消需確認；失敗保留記錄；成功沿用受保護RPC並更新統計');
 await page.click('#personal-reset');await settled();promptAnswer='9';await row('today').getByRole('button',{name:'修改數量',exact:true}).click();await settled();assert.equal(await page.evaluate(()=>testDB.bookings.find(b=>b.id==='today').quantity),10);assert.match(alerts.at(-1),/借用當日不可/);
 promptAnswer='11';await row('today').getByRole('button',{name:'修改數量',exact:true}).click();await page.waitForFunction(()=>testDB.bookings.find(b=>b.id==='today').quantity===11);await settled();
 promptAnswer='0';await row('wait').getByRole('button',{name:'修改數量',exact:true}).click();await settled();assert.match(alerts.at(-1),/有效正整數/);
 promptAnswer='20';await row('wait').getByRole('button',{name:'修改數量',exact:true}).click();await page.waitForFunction(()=>testDB.bookings.find(b=>b.id==='wait').quantity===20);await settled();
 promptAnswer='200';await row('alias').getByRole('button',{name:'修改數量',exact:true}).click();await settled();assert.match(alerts.at(-1),/庫存不足/);assert.equal(await page.evaluate(()=>testDB.bookings.find(b=>b.id==='alias').quantity),10);
 pass('保留當日不得減量、正整數、候補修改及庫存檢查');
 await page.setViewportSize({width:390,height:844});const mobileActions=await row('wait').locator('.personal-actions').boundingBox();assert.ok(mobileActions.x+mobileActions.width<=391);assert.equal(await row('wait').getByRole('button',{name:'取消借用',exact:true}).count(),1);
 await page.evaluate(()=>{document.querySelector('.personal-table-wrap').scrollLeft=0});
 if(process.env.SUMMARY_SCREENSHOT)await page.screenshot({path:process.env.SUMMARY_SCREENSHOT,fullPage:true});
 await page.evaluate(()=>{currentUser=null;previewPersonalAuthChanged()});assert.equal(await page.locator('#personal-rows button').count(),0);assert.equal(await page.locator('#personal-rows td').getAttribute('colspan'),'11');assert.deepEqual(errors,[]);
 pass('手機操作欄可見，登出清除按鈕及資料，沒有JavaScript錯誤');
}finally{await browser.close()}
