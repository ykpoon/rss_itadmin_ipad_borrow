// Visual feedback only. Status and counts are supplied by the existing booking workflow.
(function(){
 let notice=null,timer=null;
 function close(){
  clearTimeout(timer);if(!notice)return;const current=notice;notice=null;
  current.classList.add('booking-notice--exit');setTimeout(()=>current.remove(),180);
 }
 function show({title,message,kind='success'}){
  clearTimeout(timer);notice?.remove();
  const box=document.createElement('aside');box.id='booking-notice';box.className='booking-notice'+(kind==='waiting'?' booking-notice--waiting':'');
  box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.setAttribute('aria-atomic','true');
  const icon=document.createElement('div');icon.className='booking-notice-icon';icon.setAttribute('aria-hidden','true');
  if(kind==='waiting')icon.textContent='⌛';else{
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');
   const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M7 16.5 13 22 25 10');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','3');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);icon.append(svg);
  }
  const content=document.createElement('div'),heading=document.createElement('h3'),description=document.createElement('p');
  heading.className='booking-notice-title';heading.textContent=title;description.className='booking-notice-message';description.textContent=message;
  content.append(heading,description);const button=document.createElement('button');button.type='button';button.className='booking-notice-close';button.textContent='×';button.setAttribute('aria-label','關閉成功提示');button.addEventListener('click',close);
  box.append(icon,content,button);document.body.append(box);notice=box;timer=setTimeout(close,7000);
 }
 window.bookingFeedback={show,close};document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
})();
