(function(){
 const format=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):value||'';
 window.schoolDates={format};
 function enhance(){
  document.querySelectorAll('input[type="date"]').forEach(input=>{
   const initial=input.value,descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');let busy=false;
   const picker=flatpickr(input,{locale:flatpickr.l10ns.zh_tw,altInput:true,altFormat:'d/m/Y',dateFormat:'Y-m-d',ariaDateFormat:'d/m/Y',disableMobile:true,allowInput:false,defaultDate:initial||undefined,minDate:input.min||undefined,maxDate:input.max||undefined});
   picker.altInput.id=input.id+'-display';picker.altInput.placeholder='DD/MM/YYYY';picker.altInput.setAttribute('aria-label','日期（日/月/年）');
   document.querySelectorAll('label[for="'+input.id+'"]').forEach(l=>l.htmlFor=picker.altInput.id);
   Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get.call(input)},set(v){descriptor.set.call(input,v);if(!busy){busy=true;picker.setDate(v||null,false,'Y-m-d');busy=false}}});
   new MutationObserver(changes=>{for(const c of changes){if(c.attributeName==='min'||c.attributeName==='max'){busy=true;picker.set(c.attributeName==='min'?'minDate':'maxDate',input.getAttribute(c.attributeName)||undefined);busy=false}}}).observe(input,{attributes:true,attributeFilter:['min','max']});
  });
 }
 document.addEventListener('DOMContentLoaded',()=>{enhance();new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true})});
})();
