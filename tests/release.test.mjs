import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../booking-enhancements.js',import.meta.url),'utf8');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const entry=(overrides={})=>({date:today(),lesson:2,teacher_name:'Teacher A',device_type:'iPad',quantity:30,class:'1A',subject:'中文',room:'圖書館',usage_type:'basic',remarks:'原有備註',...overrides});
function harness({hostname='localhost',role='teacher',bookings=[]}={}){
 const db={bookings:structuredClone(bookings),teachers:[{name:'Teacher A',email:'teacher@example.invalid'},{name:'Teacher A alias',email:'teacher@example.invalid'},{name:'Teacher B',email:'other@example.invalid'}],admins:[{email:'admin@example.invalid'}],resources:[{name:'iPad',total_qty:2}],daily_adjustments:[]};
 const writes=[],alerts=[],state={role,dropResponse:false};
 const users={teacher:{id:'t',email:'teacher@example.invalid'},admin:{id:'a',email:'admin@example.invalid'},other:{id:'o',email:'other@example.invalid'},outsider:{id:'x',email:'unknown@example.invalid'}};
 function from(table){
  let operation='select',payload,filters=[],offset=0,end=Infinity,single=false;
  const q={select(){return q},order(){return q},range(a,b){offset=a;end=b;return q},eq(k,v){filters.push(r=>r[k]===v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},single(){single=true;return q},insert(p){operation='insert';payload=p;return q},update(p){operation='update';payload=p;return q},delete(){operation='delete';return q},then(resolve,reject){
   try{
    const match=r=>filters.every(f=>f(r));let data=db[table].filter(match);
    if(operation==='insert'){data=payload.map(b=>({...b,id:b.id||randomUUID(),created_at:new Date().toISOString()}));db[table].push(...data)}
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
 return {api:context.bookingEnhancements,db,writes,alerts,state,context};
}

test('formal batches allow real quantities on production and contain no test tags',async()=>{
 const h=harness({hostname:'rss-itadmin-ipad-borrow.vercel.app'});h.db.resources[0].total_qty=150;
 const rows=await h.api.submitEntries([entry(),entry({lesson:4})]);
 assert.equal(rows.length,2);assert.ok(rows.every(b=>b.quantity===30&&b.status==='pending'&&b.remarks==='原有備註'));
 assert.equal(h.writes.length,1);assert.ok(rows.every(b=>b.id));
});
test('existing live reservations are counted; insufficient quantity becomes waiting',async()=>{
 const h=harness({bookings:[{...entry({teacher_name:'Teacher B',class:'2A',quantity:40}),id:'real',status:'pending'}]});h.db.resources[0].total_qty=50;
 const rows=await h.api.submitEntries([entry()]);assert.equal(rows[0].status,'waiting');assert.match(rows[0].remarks,/^\[候補\]/);assert.equal(rows[0].quantity,30);
 assert.equal(h.db.bookings[0].quantity,40);
});
test('daily adjustments apply per date and returned/waiting rows do not consume stock',async()=>{
 const h=harness({bookings:[{...entry({teacher_name:'Teacher B',quantity:50}),id:'old',status:'returned'}]});h.db.resources[0].total_qty=150;h.db.daily_adjustments.push({date:today(),device_type:'iPad',available_qty:20});
 assert.equal((await h.api.submitEntries([entry()]))[0].status,'waiting');
});
test('lost response retry reuses primary keys and does not duplicate a committed batch',async()=>{
 const h=harness();h.db.resources[0].total_qty=100;h.state.dropResponse=true;const items=[entry(),entry({lesson:4})];
 await assert.rejects(()=>h.api.submitEntries(items),/response lost/);
 const retry=await h.api.submitEntries(items);assert.equal(retry.length,2);assert.equal(h.db.bookings.length,2);assert.equal(h.writes.length,1);
 assert.equal(retry[0].id,h.db.bookings[0].id);
});
test('partial receipt after a lost response stops retry rather than adding more rows',async()=>{
 const h=harness();h.state.dropResponse=true;const items=[entry(),entry({lesson:4})];
 await assert.rejects(()=>h.api.submitEntries(items));h.db.bookings.pop();
 await assert.rejects(()=>h.api.submitEntries(items),/部分已提交/);assert.equal(h.writes.length,1);
});
test('duplicate in the second slot blocks the entire batch before an insert',async()=>{
 const old={...entry(),id:'duplicate',status:'pending'};const h=harness({bookings:[old]});
 await assert.rejects(()=>h.api.submitEntries([entry({lesson:1}),entry()]),/整批未有新增/);
 assert.equal(h.writes.length,0);assert.deepEqual(h.db.bookings,[old]);
});
test('dates, positive integers, required fields and teacher identity are checked',async()=>{
 const h=harness();
 for(const values of [{quantity:0},{quantity:1.5},{quantity:2147483648},{teacher_name:'Teacher B'},{date:'2099-02-30'},{date:'2020-01-01'},{lesson:8},{room:''},{usage_type:''}])await assert.rejects(()=>h.api.submitEntries([entry(values)]));
 assert.equal(h.writes.length,0);
});
test('suspension at any batch date blocks all entries; admin delegation is retained',async()=>{
 const h=harness();h.db.teachers[0].is_suspended=true;h.db.teachers[0].suspended_until='2099-01-01';
 await assert.rejects(()=>h.api.submitEntries([entry(),entry({lesson:4})]),/停借期/);assert.equal(h.writes.length,0);
 h.state.role='admin';const rows=await h.api.submitEntries([entry()]);assert.equal(rows[0].user_email,'admin@example.invalid');
});
test('personal summary includes aliases, delegated records and history, excluding others',async()=>{
 const h=harness({bookings:[{...entry(),id:'own',status:'returned'},{...entry({teacher_name:'Teacher A alias'}),id:'delegate',user_email:'admin@example.invalid'},{...entry({teacher_name:'Teacher B'}),id:'other',user_email:'teacher@example.invalid'}]});
 assert.deepEqual(Array.from(await h.api.loadMine(),r=>r.id),['own','delegate']);h.state.role='admin';assert.equal((await h.api.loadMine()).length,0);
});
test('unlisted accounts cannot submit or retrieve a personal summary',async()=>{
 const h=harness({role:'outsider'});await assert.rejects(()=>h.api.submitEntries([entry()]),/教師名單/);await assert.rejects(()=>h.api.loadMine(),/教師名單/);assert.equal(h.writes.length,0);
});
test('teachers cannot operate another teacher booking, even if they submitted it',async()=>{
 const h=harness({bookings:[{...entry({teacher_name:'Teacher B'}),id:'other',user_email:'teacher@example.invalid'}]});
 await assert.rejects(()=>h.api.checkedBooking('other'),/其他老師/);
});
test('pickup/return requires admin and valid transitions; repeat does not add a write',async()=>{
 const h=harness({bookings:[{...entry({quantity:1}),id:'test',status:'pending'}]});
 await assert.rejects(()=>h.api.setStatus('test','borrowed'),/管理員/);h.state.role='admin';
 await assert.rejects(()=>h.api.setStatus('test','returned'),/先標記已取/);
 await h.api.setStatus('test','borrowed');await h.api.setStatus('test','borrowed');assert.equal(h.writes.length,1);
 await h.api.setStatus('test','returned');await assert.rejects(()=>h.api.setStatus('test','borrowed'),/只有待取/);
});
test('admin cannot manually pick up a waiting reservation without sufficient stock',async()=>{
 const h=harness({role:'admin',bookings:[{...entry(),id:'wait',status:'waiting'},{...entry({teacher_name:'Teacher B',quantity:40}),id:'pending',status:'pending'}]});h.db.resources[0].total_qty=50;
 await assert.rejects(()=>h.api.setStatus('wait','borrowed'),/庫存不足/);assert.equal(h.writes.length,0);
});
