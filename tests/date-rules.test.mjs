// Isolated PostgreSQL tests. npm install --no-save @electric-sql/pglite to run.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const users={teacher:{sub:'00000000-0000-4000-8000-000000000001',email:'teacher@example.invalid'},admin:{sub:'00000000-0000-4000-8000-000000000002',email:'admin@example.invalid'},other:{sub:'00000000-0000-4000-8000-000000000003',email:'other@example.invalid'}};
async function as(db,user,query,params=[]){return db.transaction(async tx=>{await tx.exec('set local role '+(user?'authenticated':'anon'));await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(user||{})]);return tx.query(query,params)})}
const cancel=(db,user,id)=>as(db,user,'select public.ipad_cancel_booking_before_day_v1($1) as result',[id]);
async function insert(db,user,values={}){
 const b={date:'2026-12-31',teacher_name:'Teacher',device_type:'iPad',quantity:10,status:'pending',user_email:user?.email||'teacher@example.invalid',...values};
 const sql="insert into public.bookings(date,lesson,teacher_name,device_type,quantity,room,subject,class,status,user_email,usage_type,remarks) values($1,3,$2,$3,$4,'Hall','Math','1A',$5,$6,'basic','[候補] note') returning id";
 const args=[b.date,b.teacher_name,b.device_type,b.quantity,b.status,b.user_email];return (await (user===undefined?db.query(sql,args):as(db,user,sql,args))).rows[0].id;
}
test('date cutoff, cancellation authorization and atomic queue promotion',async t=>{
 const db=new PGlite();await db.exec(read('./fixtures/date-rules-schema.sql'));
 await db.exec("insert into teachers(name,email) values('Teacher','teacher@example.invalid'),('Alias','teacher@example.invalid'),('Other','other@example.invalid');insert into admins(email) values('admin@example.invalid');insert into resources(name,total_qty) values('iPad',50);grant select on admins,resources,daily_adjustments to authenticated;alter table admins enable row level security;create policy admin_read on admins for select to authenticated using(true)");
 const future=await insert(db,undefined,{date:'2027-01-04'});const before=(await db.query('select * from bookings order by id')).rows;
 await db.exec(read('../database/booking-date-rules.sql'));await db.exec(read('../database/activate-booking-date-rules.sql'));
 await db.exec(read('../database/close-same-day-edits.sql'));
 assert.deepEqual((await db.query('select * from bookings order by id')).rows,before);
 // Fix school date for deterministic boundary tests only in this isolated database.
 await db.exec("create or replace function ipad_date_rules.school_today() returns date language sql stable security invoker set search_path='' as $$select date '2026-12-30'$$");
 await t.test('new 2027 dates and mixed batch rejected for teacher and admin',async()=>{
  for(const user of [users.teacher,users.admin])await assert.rejects(()=>insert(db,user,{date:'2027-01-01'}),/暫未開放/);
  const n=(await db.query('select count(*)::int n from bookings')).rows[0].n;
  await assert.rejects(()=>as(db,users.teacher,"insert into bookings(date,lesson,teacher_name,device_type,quantity,room,subject,class,user_email) values('2026-12-31',1,'Teacher','iPad',1,'Hall','Math','1A','teacher@example.invalid'),('2027-01-01',2,'Teacher','iPad',1,'Hall','Math','1A','teacher@example.invalid')"),/暫未開放/);
  assert.equal((await db.query('select count(*)::int n from bookings')).rows[0].n,n);
 });
 await t.test('Dec31 valid; old raw delete denied; new RPC cancels prior to date',async()=>{
  const id=await insert(db,users.teacher);
  await assert.rejects(()=>as(db,users.teacher,'delete from bookings where id=$1',[id]),/重新整理/);
  await cancel(db,users.teacher,id);assert.equal((await db.query('select * from bookings where id=$1',[id])).rows.length,0);
  await assert.rejects(()=>insert(db,users.teacher,{date:'2027-01-01'}),/暫未開放/);
 });
 await t.test('same-day/past cancellation and all quantity edits blocked; admin exception retained',async()=>{
  const same=await insert(db,users.teacher,{date:'2026-12-30'}),past=await insert(db,undefined,{date:'2026-12-29'});
  for(const id of [same,past])await assert.rejects(()=>cancel(db,users.teacher,id),/前一天/);
  for(const quantity of [5,10,11])await assert.rejects(()=>as(db,users.teacher,'update bookings set quantity=$1 where id=$2',[quantity,same]),/已過修改及取消期限/);
  await as(db,users.admin,'update bookings set quantity=11 where id=$1',[same]);
  await assert.rejects(()=>as(db,users.teacher,"update bookings set status='returned' where id=$1",[same]),/管理員/);
  for(const id of [same,past])await cancel(db,users.admin,id);
 });
 await t.test('Hong Kong day boundary closes edits; admin cancellation still promotes same-day queue',async()=>{
  const id=await insert(db,users.teacher,{quantity:20}),wait=await insert(db,undefined,{status:'waiting',teacher_name:'Other',quantity:25});
  await as(db,users.teacher,'update bookings set quantity=21 where id=$1',[id]);
  await db.exec("create or replace function ipad_date_rules.school_today() returns date language sql stable security invoker set search_path='' as $$select date '2026-12-31'$$");
  try{
   for(const quantity of [19,21,22])await assert.rejects(()=>as(db,users.teacher,'update bookings set quantity=$1 where id=$2',[quantity,id]),/已過修改及取消期限/);
   await assert.rejects(()=>cancel(db,users.teacher,id),/前一天/);
   assert.equal((await db.query('select quantity from bookings where id=$1',[id])).rows[0].quantity,21);
   await as(db,users.admin,'update bookings set quantity=20 where id=$1',[id]);
   await cancel(db,users.admin,id);
   assert.deepEqual((await db.query("select status,quantity from bookings where date='2026-12-31' order by status")).rows,[{status:'pending',quantity:20},{status:'waiting',quantity:5}]);
  }finally{
   await db.exec("create or replace function ipad_date_rules.school_today() returns date language sql stable security invoker set search_path='' as $$select date '2026-12-30'$$;delete from bookings where date='2026-12-31'");
  }
 });
 await t.test('ownership, status and anonymous requests checked in database',async()=>{
  const id=await insert(db,users.teacher,{teacher_name:'Alias'});
  await assert.rejects(()=>cancel(db,users.other,id),/其他老師/);
  await assert.rejects(()=>cancel(db,null,id),/permission denied/);
  await assert.rejects(()=>as(db,users.teacher,"insert into admins(email) values('teacher@example.invalid')"),/permission denied/);
  await cancel(db,users.teacher,id);
  const taken=await insert(db,undefined,{status:'borrowed'});await assert.rejects(()=>cancel(db,users.teacher,taken),/管理員/);await cancel(db,users.admin,taken);
 });
 await t.test('existing 2027 records preserved and cancellable with partial FIFO promotion',async()=>{
  await assert.rejects(()=>as(db,users.teacher,'update bookings set quantity=11 where id=$1',[future]),/暫未開放/);
  await as(db,users.admin,"update bookings set status='borrowed' where id=$1",[future]);
  const waiter=await insert(db,undefined,{date:'2027-01-04',quantity:15,status:'waiting',teacher_name:'Other',user_email:users.other.email});
  const original=(await db.query('select * from bookings where id=$1',[waiter])).rows[0];
  assert.equal((await cancel(db,users.admin,future)).rows[0].result.promoted_count,1);
  const rows=(await db.query("select * from bookings where date='2027-01-04' order by status")).rows;
  assert.equal(rows.length,2);assert.deepEqual(rows.map(b=>[b.status,b.quantity]),[['pending',10],['waiting',5]]);
  for(const row of rows)for(const k of ['created_at','teacher_name','usage_type','user_email','class','subject','room'])assert.deepEqual(row[k],original[k]);
  assert.equal(rows[0].id,waiter);
 });
 await t.test('failure during split rolls back cancellation and restores queue/context',async()=>{
  const id=await insert(db,users.teacher,{quantity:7}),waiter=await insert(db,undefined,{quantity:12,status:'waiting',teacher_name:'Other'});
  const snapshot=(await db.query('select * from bookings order by id')).rows;
  await db.exec("create function public.qa_reject_split() returns trigger language plpgsql as $$begin if new.status='waiting' then raise exception 'forced split failure';end if;return new;end$$;create trigger qa_reject_split before insert on bookings for each row execute function public.qa_reject_split()");
  await assert.rejects(()=>cancel(db,users.teacher,id),/forced split failure/);
  assert.deepEqual((await db.query('select * from bookings order by id')).rows,snapshot);
  await db.exec('drop trigger qa_reject_split on bookings');await cancel(db,users.teacher,id);
  await assert.rejects(()=>as(db,users.teacher,'delete from bookings where id=$1',[waiter]),/重新整理/);
 });
 await t.test('returned cancellation never promotes queue; full promotions keep metadata',async()=>{
  const returned=await insert(db,undefined,{date:'2026-12-28',status:'returned'}),wait=await insert(db,undefined,{date:'2026-12-28',status:'waiting'});
  await cancel(db,users.admin,returned);assert.equal((await db.query('select status from bookings where id=$1',[wait])).rows[0].status,'waiting');
  const full=await insert(db,users.teacher,{quantity:20,device_type:'Mobile'});await db.exec("insert into resources(name,total_qty)values('Mobile',30)");
  const a=await insert(db,undefined,{quantity:5,status:'waiting',device_type:'Mobile'}),b=await insert(db,undefined,{quantity:7,status:'waiting',device_type:'Mobile'});
  assert.equal((await cancel(db,users.teacher,full)).rows[0].result.promoted_count,2);
  for(const id of [a,b])assert.equal((await db.query('select status from bookings where id=$1',[id])).rows[0].status,'pending');
 });
 await t.test('all installed functions are invoker and private helpers have fixed search paths',async()=>{
  const rows=(await db.query("select prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ipad_date_rules' or p.proname='ipad_cancel_booking_before_day_v1'")).rows;
  assert.ok(rows.every(r=>!r.prosecdef&&r.proconfig.some(c=>c.startsWith('search_path='))));
 });
 await db.close();
});
