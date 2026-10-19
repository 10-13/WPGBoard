/* Application composition: persistence, dialogs and the nation editor.
 * The viewer and optional painter communicate only through MapIndex's API. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),index=window.MapIndex;
  const ORIGINAL_HTML='<!doctype html>\n'+document.documentElement.outerHTML;
  const EMBEDDED=JSON.parse($('atlas-data').textContent);
  const icons={
    folder:'M3 6h6l2 2h10v11H3z M3 6V4h7l2 2',download:'M12 3v11 m-4-4 4 4 4-4 M4 15v5h16v-5',chevron:'m7 10 5 5 5-5',plus:'M12 5v14 M5 12h14',minus:'M5 12h14',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18',brush:'m14 5 5-3 3 3-9 10-4-4z M9 12c-6-1-2 7-7 8 6 2 10-1 9-5',cursor:'m5 3 14 10-7 1-4 6z',eraser:'m9 19-6-6L14 2l8 8-11 11H7 M7 9l8 8',hand:'M8 12V6a2 2 0 0 1 4 0v6 M12 10V4a2 2 0 0 1 4 0v8 M16 9a2 2 0 0 1 4 0v7c0 4-3 6-6 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l1 1',undo:'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 0 12',redo:'m15 5 5 5-5 5 M20 10H10a6 6 0 0 0 0 12',help:'M12 16v.1 M9 8a3 3 0 1 1 4 3c-1 1-1 1-1 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',fit:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',close:'m6 6 12 12 M18 6 6 18',save:'M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',share:'M12 16V3 m-4 4 4-4 4 4 M5 11v10h14V11',upload:'M12 16V3 m-4 4 4-4 4 4 M4 15v6h16v-6',crosshair:'M12 2v5 M12 17v5 M2 12h5 M17 12h5 M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0',edit:'m15 4 5 5 M4 16 17 3a2 2 0 0 1 3 3L7 19l-4 1z',layers:'m12 3 10 5-10 5L2 8z M3 13l9 5 9-5 M3 18l9 5 9-5'};
  const icon=name=>{const span=document.createElement('span');span.dataset.icon=name;span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.globe}"/></svg>`;return span;};
  for(const el of document.querySelectorAll('[data-icon]'))el.replaceWith(icon(el.dataset.icon));
  const viewer=new AtlasView.MapViewer(index),painter=new AtlasPlugins.TerritoryPainter(index,viewer);
  window.Atlas={index,viewer,painter};
  let ready=false,tool='paint',toastTimer,saveTimer,saveRevision=0,busy=false,editingNation=null,editingRegion=null,deleteArmed=false;
  const format=n=>n.toLocaleString('ru-RU');
  const plural=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
  const provinceCount=n=>format(n)+' '+plural(n,'провинция','провинции','провинций');
  const uid=prefix=>prefix+'-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
  function setBusy(value,title='Собираем ваш мир',detail='Подготовка карты…'){
    busy=value;$('loading-overlay').hidden=!value;$('loading-title').textContent=title;$('loading-detail').textContent=detail;
    for(const id of ['export-png','file-menu-button','add-nation','add-nation-wide','add-region'])$(id).disabled=value;
    if(value){viewer.ready=false;$('map-tooltip').hidden=true;}else viewer.ready=ready;
  }
  function saveLabel(message,state='ok'){$('save-status').textContent=message;$('save-dot').className='save-dot'+(state==='ok'?'':' '+state);}
  const dbPromise=new Promise((resolve,reject)=>{
    try{const request=indexedDB.open('atlas-vpi-v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('parties'))request.result.createObjectStore('parties');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}catch(e){reject(e);}
  });
  dbPromise.catch(()=>{});
  async function getSaved(key){const db=await dbPromise;return new Promise((resolve,reject)=>{const r=db.transaction('parties').objectStore('parties').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function persist(){
    if(!ready)return;const revision=++saveRevision,project=index.toJSON();
    try{const db=await dbPromise;await new Promise((resolve,reject)=>{const tx=db.transaction('parties','readwrite');tx.objectStore('parties').put(project,project.saveId);if(project.saveId!==EMBEDDED.saveId)tx.objectStore('parties').put(project,EMBEDDED.saveId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});if(revision===saveRevision)saveLabel('Все изменения сохранены');}
    catch(e){if(revision===saveRevision)saveLabel('Сохраните партию в JSON','error');}
  }
  function scheduleSave(){saveLabel('Сохраняем изменения…','dirty');clearTimeout(saveTimer);saveTimer=setTimeout(persist,450);}
  function imageFrom(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Не удалось прочитать изображение карты.'));image.src=url;});}
  async function prepare(project){
    AtlasCore.MapRegistry.validate(project);
    const [base,encoded]=await Promise.all([imageFrom(project.baseImage),imageFrom(project.indexImage)]);
    const w=project.width,h=project.height;
    if(base.width!==w||base.height!==h||encoded.width!==w||encoded.height!==h)throw new Error('Изображения и индекс имеют разные размеры.');
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(encoded,0,0);const pixels=ctx.getImageData(0,0,w,h).data;
    const maxId=Math.max(...project.provinces.map(p=>p.id)),labels=maxId<65536?new Uint16Array(w*h):new Uint32Array(w*h),valid=new Uint8Array(maxId+1),counts=new Uint32Array(maxId+1);
    const minX=new Int32Array(maxId+1).fill(w),minY=new Int32Array(maxId+1).fill(h),maxX=new Int32Array(maxId+1),maxY=new Int32Array(maxId+1);
    for(const p of project.provinces)valid[p.id]=1;
    for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){
      const o=i*4,id=pixels[o]+pixels[o+1]*256+pixels[o+2]*65536;
      if(id&&!valid[id])throw new Error('В индексе найден неизвестный номер провинции.');labels[i]=id;
      if(id){counts[id]++;if(x<minX[id])minX[id]=x;if(y<minY[id])minY[id]=y;if(x>maxX[id])maxX[id]=x;if(y>maxY[id])maxY[id]=y;}
    }
    for(const p of project.provinces){const box=[minX[p.id],minY[p.id],maxX[p.id]-minX[p.id]+1,maxY[p.id]-minY[p.id]+1];if(counts[p.id]!==p.area||box.some((v,i)=>v!==p.bbox[i])||labels[p.anchor[1]*w+p.anchor[0]]!==p.id)throw new Error('Данные провинций не соответствуют пиксельному индексу.');}
    c.width=1;c.height=1;return {base,labels};
  }
  async function loadProject(project,save=true){
    setBusy(true,'Открываем карту','Проверяем провинции и их номера…');
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const prepared=await prepare(project);viewer.load(prepared.base);index.load(project,prepared.labels);ready=true;viewer.ready=true;
    viewer.drawNumbers();render();renderSelected();setBusy(false);saveLabel('Карта готова');
    if(save)await persist();return index;
  }
  function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
  function render(){
    $('campaign-title').value=index.title;$('header-title').textContent=index.title;$('map-name').textContent=index.project.mapName||'Карта';
    $('nation-count').textContent=index.nations.size;$('region-count').textContent=index.regions.size;
    const counts=new Map(),regionCounts=new Map();let claimed=0;
    for(const p of index.provinces.values()){if(p.nationId){counts.set(p.nationId,(counts.get(p.nationId)||0)+1);claimed++;}if(p.regionId)regionCounts.set(p.regionId,(regionCounts.get(p.regionId)||0)+1);}
    $('neutral-count').textContent=format(index.provinces.size-claimed);
    $('nation-list').replaceChildren();
    for(const nation of index.nations.values()){
      const row=document.createElement('div');row.className='nation-row'+(painter.activeNationId===nation.id?' active':'');
      const select=document.createElement('button');select.className='nation-select';select.setAttribute('aria-pressed',String(painter.activeNationId===nation.id));
      const swatch=document.createElement('span');swatch.className='nation-swatch';swatch.style.background=nation.color;
      const text=document.createElement('span');text.className='nation-text';const name=document.createElement('strong');name.textContent=nation.name;const count=document.createElement('small');count.textContent=provinceCount(counts.get(nation.id)||0);text.append(name,count);select.append(swatch,text);select.onclick=()=>{painter.setActiveNation(nation.id);setTool('paint');};
      const edit=document.createElement('button');edit.className='icon-button';edit.title='Редактировать нацию';edit.setAttribute('aria-label','Редактировать '+nation.name);edit.append(icon('edit'));edit.onclick=()=>openNation(nation.id);row.append(select,edit);$('nation-list').append(row);
    }
    $('region-list').replaceChildren();
    if(!index.regions.size){const p=document.createElement('div');p.className='region-empty';p.textContent='Пока нет регионов';$('region-list').append(p);}
    for(const region of index.regions.values()){
      const row=document.createElement('div');row.className='region-row';const edit=document.createElement('button');edit.className='region-edit';edit.append(icon('layers'));const name=document.createElement('span');name.textContent=region.name;edit.append(name);edit.title='Редактировать регион';edit.onclick=()=>openRegion(region.id);
      const count=document.createElement('small');count.textContent=regionCounts.get(region.id)||0;
      const paint=document.createElement('button');paint.className='icon-button';paint.append(icon('brush'));paint.title='Назначить весь регион выбранной нации';paint.setAttribute('aria-label','Закрасить регион '+region.name);paint.disabled=!index.nations.has(painter.activeNationId)||!regionCounts.get(region.id);paint.onclick=()=>{painter.paintRegion(region.id);toast('Регион «'+region.name+'» назначен нации');};row.append(edit,count,paint);$('region-list').append(row);
    }
    const active=index.nations.get(painter.activeNationId);$('active-color').style.background=active?.color||'#eee9dd';$('active-nation').textContent=tool==='erase'?'Освобождение территорий':tool==='inspect'?'Просмотр провинций':tool==='pan'?'Перемещение карты':active?.name||'Создайте нацию для раскраски';
    $('map-summary').textContent=provinceCount(index.provinces.size)+' · '+format(index.nations.size)+' '+plural(index.nations.size,'нация','нации','наций');
    $('status-left').textContent='Назначено: '+format(claimed)+' из '+format(index.provinces.size);$('dimensions').textContent=index.width+' × '+index.height+' px';
    $('undo').disabled=!index.undoStack.length;$('redo').disabled=!index.redoStack.length;
    renderSelected();
  }
  function renderSelected(){
    const p=index.getProvince(viewer.selectedId);$('selected-id').textContent=p?'#'+p.id:'НЕ ВЫБРАНА';$('province-empty').hidden=!!p;$('province-details').hidden=!p;
    if(!p)return;
    if(document.activeElement!==$('province-name'))$('province-name').value=p.name;
    $('province-owner').replaceChildren(option('','Свободная территория'),...[...index.nations.values()].map(n=>option(n.id,n.name)));$('province-owner').value=p.nationId||'';
    $('province-region').replaceChildren(option('','Без региона'),...[...index.regions.values()].map(r=>option(r.id,r.name)));$('province-region').value=p.regionId||'';
    $('paint-selected-region').hidden=!p.regionId;$('paint-selected-region').disabled=!index.nations.has(painter.activeNationId);
    $('province-meta').textContent=format(p.area)+' px · X '+p.anchor[0]+' · Y '+p.anchor[1];
  }
  function renderTooltip({id,province}){
    const tip=$('map-tooltip');tip.hidden=!id;if(!province)return;tip.replaceChildren();
    const title=document.createElement('strong');title.textContent=province.name?province.name+' · #'+id:'Провинция #'+id;
    const owner=document.createElement('div');owner.className='tooltip-owner';const dot=document.createElement('span');dot.className='tooltip-dot';const nation=index.nations.get(province.nationId);dot.style.background=nation?.color||'#ded9c9';owner.append(dot,document.createTextNode(nation?.name||'Свободная территория'));tip.append(title,owner);
    const region=index.regions.get(province.regionId);if(region){const label=document.createElement('small');label.textContent=region.name;tip.append(label);}
  }
  index.on('province:hover',renderTooltip);index.on('selection:change',renderSelected);index.on('painter:active',render);
  index.on('change',()=>{render();scheduleSave();if(viewer.hoverId)renderTooltip({id:viewer.hoverId,province:index.getProvince(viewer.hoverId)});});
  function setTool(name){
    tool=name;painter.mode=name;viewer.panMode=name==='pan';$('viewport').classList.toggle('pan',viewer.panMode);
    for(const b of document.querySelectorAll('[data-tool]')){b.classList.toggle('active',b.dataset.tool===name);b.setAttribute('aria-pressed',String(b.dataset.tool===name));}if(ready)render();
  }
  for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool);
  $('toggle-sidebar').onclick=()=>{const atFit=Math.abs(viewer.scale-viewer.fitScale())<.005;document.body.classList.toggle('sidebar-collapsed');$('toggle-sidebar').setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-collapsed')));requestAnimationFrame(()=>{if(atFit)viewer.fit();else{viewer.constrain();viewer.transform();}});};
  $('undo').onclick=()=>index.undo();$('redo').onclick=()=>index.redo();
  $('show-ids').onchange=e=>{viewer.showNumbers=e.target.checked;viewer.drawNumbers();};
  $('zoom-in').onclick=()=>viewer.zoom(1.3);$('zoom-out').onclick=()=>viewer.zoom(1/1.3);$('fit-map').onclick=()=>viewer.fit();
  $('campaign-title').onchange=e=>index.setTitle(e.target.value);
  $('province-name').onchange=e=>{if(viewer.selectedId)index.setProvince(viewer.selectedId,{name:e.target.value});};
  $('province-owner').onchange=e=>{if(viewer.selectedId)painter.paintProvince(viewer.selectedId,e.target.value||null);};
  $('province-region').onchange=e=>{if(viewer.selectedId)index.setProvince(viewer.selectedId,{regionId:e.target.value||null});};
  $('paint-selected-region').onclick=()=>{const p=index.getProvince(viewer.selectedId);if(p?.regionId){painter.paintRegion(p.regionId);toast('Весь регион назначен выбранной нации');}};
  const palette=['#517eaa','#c47862','#75937d','#b49b5e','#8e7ba5','#759da6'];
  function showDialog(id){$('file-menu').hidden=true;$('file-menu-button').setAttribute('aria-expanded','false');$(id).showModal();}
  for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
  for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
  function updateColor(){ $('color-value').textContent=$('nation-color').value.toUpperCase(); }
  for(const color of palette){const b=document.createElement('button');b.type='button';b.style.background=color;b.title=color;b.setAttribute('aria-label','Цвет '+color);b.onclick=()=>{$('nation-color').value=color;updateColor();};$('color-presets').append(b);}
  $('nation-color').oninput=updateColor;
  function openNation(id=null){
    editingNation=id;deleteArmed=false;const nation=index.nations.get(id);$('nation-dialog-title').textContent=nation?'Редактировать нацию':'Новая нация';$('nation-name').value=nation?.name||'';$('nation-color').value=nation?.color||palette[index.nations.size%palette.length];updateColor();$('delete-nation').hidden=!nation;$('delete-nation').textContent='Удалить нацию';showDialog('nation-dialog');setTimeout(()=>$('nation-name').focus(),30);
  }
  $('add-nation').onclick=()=>openNation();$('add-nation-wide').onclick=()=>openNation();
  $('nation-form').onsubmit=e=>{e.preventDefault();const name=$('nation-name').value.trim();if(!name){$('nation-name').focus();return;}if(!editingNation&&index.nations.size>=500){toast('Можно создать не более 500 наций');return;}const id=editingNation||uid('nation');index.setNation({id,name,color:$('nation-color').value});painter.setActiveNation(id);setTool('paint');$('nation-dialog').close();};
  $('delete-nation').onclick=()=>{if(!deleteArmed){deleteArmed=true;$('delete-nation').textContent='Освободить земли и удалить?';return;}index.removeNation(editingNation);$('nation-dialog').close();toast('Нация удалена. Действие можно отменить.');};
  function openRegion(id=null){editingRegion=id;deleteArmed=false;const r=index.regions.get(id);$('region-dialog-title').textContent=r?'Редактировать регион':'Новый регион';$('region-name').value=r?.name||'';$('delete-region').hidden=!r;$('delete-region').textContent='Удалить регион';showDialog('region-dialog');setTimeout(()=>$('region-name').focus(),30);}
  $('add-region').onclick=()=>openRegion();
  $('region-form').onsubmit=e=>{e.preventDefault();const name=$('region-name').value.trim();if(!name)return;const id=editingRegion||uid('region');index.setRegion({id,name});$('region-dialog').close();if(viewer.selectedId&&!editingRegion){index.setProvince(viewer.selectedId,{regionId:id});toast('Выбранная провинция добавлена в регион');}};
  $('delete-region').onclick=()=>{if(!deleteArmed){deleteArmed=true;$('delete-region').textContent='Удалить группу провинций?';return;}index.removeRegion(editingRegion);$('region-dialog').close();};
  $('help').onclick=()=>showDialog('help-dialog');
  $('file-menu-button').onclick=()=>{const menu=$('file-menu');menu.hidden=!menu.hidden;$('file-menu-button').setAttribute('aria-expanded',String(!menu.hidden));};
  document.addEventListener('click',e=>{if(!e.target.closest('#file-menu,#file-menu-button')){$('file-menu').hidden=true;$('file-menu-button').setAttribute('aria-expanded','false');}});
  function safeFilename(){return index.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,60)||'АТЛАС';}
  function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);$('file-menu').hidden=true;$('file-menu-button').setAttribute('aria-expanded','false');}
  function exportJSON(){if(!ready)return;download(new Blob([JSON.stringify(index.toJSON())],{type:'application/json'}),safeFilename()+'.json');toast('Партия сохранена в JSON');}
  $('save-json').onclick=exportJSON;
  $('save-html').onclick=()=>{if(!ready)return;const snapshot=index.toJSON();snapshot.saveId=uid('party');const doc=new DOMParser().parseFromString(ORIGINAL_HTML,'text/html');doc.getElementById('atlas-data').textContent=JSON.stringify(snapshot).replace(/</g,'\\u003c');download(new Blob(['<!doctype html>\n'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}),safeFilename()+'.html');toast('HTML содержит редактор и текущую карту. Можно переслать друзьям.');};
  $('export-png').onclick=async()=>{
    if(!ready||busy)return;const b=$('export-png');b.disabled=true;
    try{await new Promise(r=>requestAnimationFrame(r));const canvas=painter.exportCanvas($('show-ids').checked);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error('Не удалось создать PNG');download(blob,safeFilename()+'.png');canvas.width=1;canvas.height=1;toast('PNG сохранён в исходном разрешении '+index.width+' × '+index.height);}
    catch(e){toast(e.message);}finally{b.disabled=false;}
  };
  $('open-json').onclick=()=>{$('json-file').click();$('file-menu').hidden=true;};
  $('json-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>40000000)throw new Error('Файл слишком большой. Максимум 40 МБ.');await persist();await loadProject(JSON.parse(await file.text()));toast('Партия открыта');}catch(error){setBusy(false);toast(error.message);}finally{e.target.value='';}};
  $('upload-map').onclick=()=>showDialog('map-dialog');
  function segmentRGBA(data,width,height,color,tolerance){
    const total=width*height,mask=new Uint8Array(total),labels=new Uint32Array(total),queue=new Uint32Array(total),provinces=[];
    for(let i=0;i<total;i++){const j=i*4;mask[i]=data[j+3]>128&&Math.max(Math.abs(data[j]-color[0]),Math.abs(data[j+1]-color[1]),Math.abs(data[j+2]-color[2]))<=tolerance?1:0;}
    for(let start=0;start<total;start++){
      if(!mask[start]||labels[start])continue;const id=provinces.length+1;if(id>100000)throw new Error('Слишком много мелких областей. Уменьшите допуск или используйте более чистый PNG.');
      let head=0,tail=1,sx=0,sy=0,minX=width,minY=height,maxX=0,maxY=0;queue[0]=start;labels[start]=id;
      while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);sx+=x;sy+=y;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        if(x>0&&mask[p-1]&&!labels[p-1]){labels[p-1]=id;queue[tail++]=p-1;}if(x<width-1&&mask[p+1]&&!labels[p+1]){labels[p+1]=id;queue[tail++]=p+1;}if(y>0&&mask[p-width]&&!labels[p-width]){labels[p-width]=id;queue[tail++]=p-width;}if(y<height-1&&mask[p+width]&&!labels[p+width]){labels[p+width]=id;queue[tail++]=p+width;}}
      const cx=sx/tail,cy=sy/tail;let nearest=start,distance=Infinity;
      for(let q=0;q<tail;q++){const p=queue[q],d=(p%width-cx)**2+(Math.floor(p/width)-cy)**2;if(d<distance){distance=d;nearest=p;}}
      provinces.push({id,area:tail,bbox:[minX,minY,maxX-minX+1,maxY-minY+1],anchor:[nearest%width,Math.floor(nearest/width)]});
      if(id%250===0)postMessage({progress:Math.round(start/total*100),count:id});
    }
    if(!provinces.length)throw new Error('Не найден цвет суши. Проверьте цвет и допуск.');
    return {labels,provinces};
  }
  async function indexImage(data,width,height,color,tolerance){
    const code='const segment='+segmentRGBA.toString()+';onmessage=e=>{try{const d=e.data,r=segment(new Uint8ClampedArray(d.pixels),d.width,d.height,d.color,d.tolerance);postMessage({result:{provinces:r.provinces,buffer:r.labels.buffer}},[r.labels.buffer]);}catch(error){postMessage({error:error.message});}};';
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));let worker;
    try{worker=new Worker(url);return await new Promise((resolve,reject)=>{worker.onmessage=e=>{if(e.data.error)reject(new Error(e.data.error));else if(e.data.result)resolve({provinces:e.data.result.provinces,labels:new Uint32Array(e.data.result.buffer)});else $('loading-detail').textContent='Найдено '+format(e.data.count)+' областей · '+e.data.progress+'%';};worker.onerror=()=>reject(new Error('Не удалось запустить разбор карты в этом браузере. Попробуйте Chrome, Edge или Safari.'));worker.postMessage({pixels:data.buffer,width,height,color,tolerance},[data.buffer]);});}
    finally{worker?.terminate();URL.revokeObjectURL(url);}
  }
  $('map-form').onsubmit=async e=>{
    e.preventDefault();const file=$('map-file').files[0];if(!file)return;
    const hex=$('land-color').value,color=[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5),16)],tolerance=Math.max(0,Math.min(80,Number($('color-tolerance').value)||0));
    $('map-dialog').close();setBusy(true,'Разбираем карту','Ищем замкнутые области суши…');let objectURL;
    try{
      await persist();if(file.size>30000000)throw new Error('Максимальный размер изображения — 30 МБ.');objectURL=URL.createObjectURL(file);const image=await imageFrom(objectURL),width=image.width,height=image.height;
      if(width*height>20000000)throw new Error('Максимум 20 миллионов пикселей. Уменьшите изображение.');
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const baseImage=c.toDataURL('image/png'),pixels=ctx.getImageData(0,0,width,height).data;
      const result=await indexImage(pixels,width,height,color,tolerance),encoded=ctx.createImageData(width,height);
      for(let i=0;i<result.labels.length;i++){const id=result.labels[i],j=i*4;encoded.data[j]=id&255;encoded.data[j+1]=(id>>8)&255;encoded.data[j+2]=(id>>16)&255;encoded.data[j+3]=255;}
      ctx.putImageData(encoded,0,0);const project={schemaVersion:1,saveId:uid('party'),title:file.name.replace(/\.[^.]+$/,''),mapName:file.name,width,height,baseImage,indexImage:c.toDataURL('image/png'),provinces:result.provinces,nations:[...index.nations.values()],regions:[],owners:{},regionAssignments:{},provinceNames:{}};
      c.width=1;await loadProject(project);toast('Карта готова: '+provinceCount(result.provinces.length));
    }catch(error){setBusy(false);toast(error.message);}finally{if(objectURL)URL.revokeObjectURL(objectURL);$('map-file').value='';}
  };
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){$('file-menu').hidden=true;$('file-menu-button').setAttribute('aria-expanded','false');}
    if(e.target.closest('input,select,textarea')||document.querySelector('dialog[open]')||!ready||busy)return;
    if(e.ctrlKey||e.metaKey){if(e.code==='KeyZ'){e.preventDefault();e.shiftKey?index.redo():index.undo();}else if(e.code==='KeyS'){e.preventDefault();exportJSON();}return;}
    const tools={KeyB:'paint',KeyI:'inspect',KeyE:'erase',KeyH:'pan'};if(tools[e.code]){setTool(tools[e.code]);e.preventDefault();}
    if(e.key==='+'||e.key==='='){e.preventDefault();viewer.zoom(1.3);}if(e.key==='-'){e.preventDefault();viewer.zoom(1/1.3);}if(e.code==='Digit0'){e.preventDefault();viewer.fit();}
    const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(directions[e.code]){e.preventDefault();viewer.tx+=directions[e.code][0];viewer.ty+=directions[e.code][1];viewer.constrain();viewer.transform();}
  });
  window.addEventListener('pagehide',()=>{if(ready)persist();});
  $('recover-default').onclick=async()=>{try{$('recover-default').hidden=true;await loadProject(EMBEDDED);}catch(error){$('loading-detail').textContent=error.message;}};
  async function boot(){
    try{
      let saved;try{saved=await getSaved(EMBEDDED.saveId);}catch(e){}
      if(saved){try{await loadProject(saved,false);saveLabel('Партия восстановлена');return;}catch(error){console.warn('Saved map invalid:',error.message);}}
      await loadProject(EMBEDDED,false);saveLabel('Все изменения сохранены');
    }catch(error){$('loading-title').textContent='Не удалось открыть карту';$('loading-detail').textContent=error.message;$('loading-overlay').querySelector('.loader').hidden=true;$('recover-default').hidden=false;}
  }
  window.Atlas.loadProject=loadProject;window.Atlas.exportJSON=exportJSON;
  boot();
})();
