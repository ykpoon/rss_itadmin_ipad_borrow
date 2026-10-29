// In-memory API fixtures only. This file never connects to Supabase.
window.currentUser={id:'teacher-a',email:'teacher@example.invalid'};
window.isCurrentUserAdmin=false;
window.LESSON_NAMES={1:'第一節',2:'第二節'};
window.WEEKDAY_NAMES=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const booking=(id,date,status,usage_type='basic',extra={})=>({id,date,status,usage_type,lesson:1,teacher_name:'Teacher A',device_type:'iPad',quantity:10,class:'1A',subject:'ICT',room:'Room 1',remarks:'',created_at:'2026-10-20T00:00:00Z',...extra});
window.testDB={
 bookings:[booking('future','2026-10-30','pending'),booking('wait','2026-10-31','waiting','interactive'),booking('today','2026-10-29','pending'),booking('past','2026-10-28','pending'),booking('returned','2026-10-27','returned','interactive'),booking('alias','2026-11-01','pending','interactive',{teacher_name:'Teacher A alias',user_email:'admin@example.invalid'}),booking('other','2026-11-02','pending','basic',{teacher_name:'Teacher B',user_email:currentUser.email}),booking('unknown','2026-11-03','pending',null,{subject:'<img src=x onerror=window.badRender=true>'})],
 teachers:[{name:'Teacher A',email:currentUser.email},{name:'Teacher A alias',email:currentUser.email},{name:'Teacher B',email:'other@example.invalid'}],
 admins:[],resources:[{name:'iPad',total_qty:150}],daily_adjustments:[]
};
window.testWrites=[];window.failCancel=false;window.testRenders=0;
function from(table){
 let filters=[],operation='select',payload,single=false,offset=0,end=Infinity;
 const q={select(){return q},order(){return q},range(a,b){offset=a;end=b;return q},eq(k,v){filters.push(b=>b[k]===v);return q},gte(k,v){filters.push(b=>b[k]>=v);return q},lte(k,v){filters.push(b=>b[k]<=v);return q},in(k,v){filters.push(b=>v.includes(b[k]));return q},single(){single=true;return q},update(p){operation='update';payload=p;return q},
 then(resolve,reject){try{let data=testDB[table].filter(b=>filters.every(f=>f(b)));if(operation==='update'){data.forEach(b=>Object.assign(b,payload));testWrites.push({operation,ids:data.map(b=>b.id),payload})}data=structuredClone(data.slice(offset,end+1));return Promise.resolve({data:single?data[0]:data,error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;
}
window._supabase={auth:{getUser:async()=>({data:{user:currentUser},error:null})},from,rpc:async(name,args)=>{
 if(failCancel)return {data:null,error:Error('測試網絡錯誤，沒有取消')};
 testWrites.push({operation:'rpc',name,args});const index=testDB.bookings.findIndex(b=>b.id===args.p_booking_id);testDB.bookings.splice(index,1);return {data:{cancelled_id:args.p_booking_id,promoted_count:0},error:null};
}};
window.deleteBooking=async()=>{};
window.fetchAndRender=async()=>{testRenders++};window.fetchMonthlyData=async()=>{testRenders++};
