import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const source=fs.readFileSync(new URL('../preview-shared.js',import.meta.url),'utf8');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const entry=(overrides={})=>({date:today(),lesson:2,teacher_name:'Teacher A',device_type:'iPad',quantity:1,class:'1A',subject:'中文',room:'圖書館',usage_type:'basic',remarks:'',...overrides});
const tag='[PREVIEW_TEST_20261014] ';
function harness({hostname='localhost',role='teacher',bookings=[]}={}){
 const db={bookings:structuredClone(bookings),teachers:[{name:'Teacher A',email:'teacher@example.invalid'},{name:'Teacher A alias',email:'teacher@example.invalid'},{name:'Teacher B',email:'other@example.invalid'}],admins:[{email:'admin@example.invalid'}],resources:[{name:'iPad',total_qty:2}],daily_adjustments:[]};
 const writes=[],alerts=[],state={role,dropResponse:false};
 const users={teacher:{id:'t',email:'teacher@example.invalid'},admin:{id:'a',email:'admin@example.invalid'},other:{id:'o',email:'other@example.invalid'},outsider:{id:'x',email:'unknown@example.invalid'}};
 function from(table){
  let operation='select',payload,filters=[],offset=0,end=Infinity,single=false;
  const q={select(){return q},order(){return q},range(a,b){offset=a;end=b;return q},eq(k,v){filters.push(r=>r[k]===v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},single(){single=true;return q},insert(p){operation='insert';payload=p;return q},update(p){operation='update';payload=p;return q},delete(){operation='delete';return q},then(resolve,reject){
   try{
    const match=r=>filters.every(f=>f(r));let data=db[table].filter(match);
    if(operation==='insert'){data=payload.map(b=>({...b,id:randomUUID(),created_at:new Date().toISOString()}));db[table].push(...data)}
    if(operation==='update')data.forEach(r=>Object.assign(r,payload));
    if(operation==='delete')db[table]=db[table].filter(r=>!match(r));
    if(operation!=='select')writes.push({table,operation,rows:structuredClone(data)});
    if(operation==='insert'&&state.dropResponse){state.dropResponse=false;return Promise.resolve({data:null,error:Error('response lost')}).then(resolve,reject)}
    data=structuredClone(data.slice(offset,end+1));return Promise.resolve({data:single?data[0]:data,error:null}).then(resolve,reject);
   }catch(e){return Promise.reject(e).then(resolve,reject)}
  }};return q;
 }
 const storage=new Map();const context={document:{getElementById:()=>null,addEventListener:()=>{}},location:{hostname},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID},Intl,Date,console,alert:m=>alerts.push(m),_supabase:{auth:{getUser:async()=>({data:{user:users[state.role]},error:null})},from}};
 context.window=context;vm.runInNewContext(source,context);
 return {api:context.previewShared,db,writes,alerts,state,context};
}

test('bulk inserts are tagged, one device each; duplicate retry does not insert again',async()=>{
 const h=harness();h.state.dropResponse=true;
 const items=[entry(),entry({lesson:4})];
 await assert.rejects(()=>h.api.submitEntries(items),/response lost/);
 const retry=await h.api.submitEntries(items);
 assert.equal(retry.length,2);assert.equal(h.db.bookings.length,2);assert.equal(h.writes.length,1);
 assert.ok(retry.every(b=>b.quantity===1&&b.remarks.startsWith(tag)&&b.user_email==='teacher@example.invalid'));
 await assert.rejects(()=>h.api.submitEntries(items),/相同測試預約/);
});
test('real occupied slots reject the whole batch before any insert',async()=>{
 const real={...entry(),id:'real',status:'pending',remarks:'正式'};
 const h=harness({bookings:[real]});
 await assert.rejects(()=>h.api.submitEntries([entry({lesson:1}),entry()]),/正式/);
 assert.equal(h.writes.length,0);assert.deepEqual(h.db.bookings,[real]);
});
test('real records cannot be deleted or updated, including by admin',async()=>{
 const real={...entry(),id:'real',status:'pending',remarks:'正式'};const h=harness({role:'admin',bookings:[real]});
 await assert.rejects(()=>h.api.removeTest('real'),/只供查閱/);
 await assert.rejects(()=>h.api.setStatus('real','borrowed'),/只供查閱/);
 assert.equal(h.writes.length,0);assert.deepEqual(h.db.bookings,[real]);
});
test('summary uses actual teacher names, including aliases and delegated bookings',async()=>{
 const h=harness({bookings:[{...entry(),id:'own'},{...entry({teacher_name:'Teacher A alias'}),id:'delegate',user_email:'admin@example.invalid'},{...entry({teacher_name:'Teacher B'}),id:'other',user_email:'teacher@example.invalid'}]});
 assert.deepEqual(Array.from(await h.api.loadMine(),r=>r.id),['own','delegate']);
 h.state.role='admin';assert.equal((await h.api.loadMine()).length,0);
});
test('wrong identity, unlisted login, quantities and invalid dates are rejected',async()=>{
 const h=harness();
 for(const invalid of [{teacher_name:'Teacher B'},{quantity:2},{quantity:0.5},{date:'2099-02-30'},{date:'2020-01-01'},{lesson:8}])await assert.rejects(()=>h.api.submitEntries([entry(invalid)]));
 h.state.role='outsider';await assert.rejects(()=>h.api.submitEntries([entry()]),/教師名單/);assert.equal(h.writes.length,0);
});
test('only owner or admin can remove tagged tests; removal never promotes waiting rows',async()=>{
 const own={...entry(),id:'own',status:'pending',remarks:tag+'own'};
 const waiting={...entry({teacher_name:'Teacher B'}),id:'wait',status:'waiting',remarks:tag+'waiting'};
 const h=harness({bookings:[own,waiting]});await assert.rejects(()=>h.api.removeTest('wait'),/其他老師/);
 await h.api.removeTest('own');assert.equal(h.db.bookings[0].status,'waiting');assert.equal(h.writes.length,1);
});
test('status changes require admin, enforce transitions and keep teacher state unchanged',async()=>{
 const tagged={...entry(),id:'test',status:'pending',remarks:tag+'status'};const h=harness({bookings:[tagged]});const teachers=structuredClone(h.db.teachers);
 await assert.rejects(()=>h.api.setStatus('test','borrowed'),/管理員/);h.state.role='admin';
 await assert.rejects(()=>h.api.setStatus('test','returned'),/先標記已取/);
 await h.api.setStatus('test','borrowed');await h.api.setStatus('test','returned');
 await assert.rejects(()=>h.api.setStatus('test','borrowed'),/只有待取/);
 await assert.rejects(()=>h.api.setStatus('test','missed'),/只測試/);assert.deepEqual(h.db.teachers,teachers);
});
test('late real reservation or insufficient stock blocks test pickup',async()=>{
 const tagged={...entry(),id:'test',status:'pending',remarks:tag+'status'};
 const h=harness({role:'admin',bookings:[tagged,{...entry(),id:'real',status:'pending',remarks:'正式'}]});
 await assert.rejects(()=>h.api.setStatus('test','borrowed'),/正式記錄/);h.db.bookings.pop();h.db.resources[0].total_qty=0;
 await assert.rejects(()=>h.api.setStatus('test','borrowed'),/庫存不足/);assert.equal(h.writes.length,0);
});
test('production and unrecognized hosts prohibit all writes',async()=>{
 for(const hostname of ['rss-itadmin-ipad-borrow.vercel.app','unknown.example']){
  const h=harness({hostname,role:'admin',bookings:[{...entry(),id:'t',status:'pending',remarks:tag+'t'}]});
  await assert.rejects(()=>h.api.submitEntries([entry()]),/正式網址禁止寫入/);
  await assert.rejects(()=>h.api.removeTest('t'),/正式網址禁止寫入/);
  await assert.rejects(()=>h.api.setStatus('t','borrowed'),/正式網址禁止寫入/);assert.equal(h.writes.length,0);
 }
 assert.equal(harness({hostname:'rss-itadmin-ipad-borrow-abc-rss-itadmin.vercel.app'}).api.writable(),true);
});
test('legacy teacher, suspension, missed and stock mutations are disabled',()=>{
 const h=harness();for(const name of ['markAsMissed','toggleTeacherSuspend','promptSuspend','resetMissedCount','addNewTeacher','updateResourcesStock','saveDailyAdjustment','deleteDailyAdjustment'])assert.equal(h.context[name]({preventDefault(){}}),false);
 assert.equal(h.writes.length,0);assert.equal(h.alerts.length,8);
});
