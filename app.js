'use strict';
const $=s=>document.querySelector(s), stages=['전체 기록','출생','유년기','학창 시절','청년기','결혼과 가족','직장과 활동','중년 이후','기타'];
let currentView='records';
let data={version:1,people:[],events:[]},personId='',stage='전체 기록',session=null,sha=null,dirty=false,busy=false,demo=false,photos=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const person=()=>data.people.find(p=>p.id===personId);
const notice=s=>{$('#status').textContent=s;document.querySelectorAll('dialog[open] .save-status').forEach(el=>el.textContent=s);};
let formTimer=null,formRevision=0,formPending=false,formSaving=false,closeRequested=false;
function resetFormSave(){closeRequested=false;clearTimeout(formTimer);formPending=false;formRevision++;document.querySelectorAll('.save-status').forEach(el=>el.textContent='입력을 멈추면 약 2초 뒤 자동저장됩니다.');}
function scheduleFormSave(f){formPending=true;formRevision++;clearTimeout(formTimer);f.querySelector('.save-status').textContent='변경사항 자동저장 대기 중…';formTimer=setTimeout(()=>autosaveForm(f),1800);}
async function autosaveForm(f){if(!f.closest('dialog').open||!formPending)return;if(busy||formSaving){formTimer=setTimeout(()=>autosaveForm(f),500);return;}if(!f.checkValidity()){f.querySelector('.save-status').textContent='아직 저장되지 않았습니다. 이름 또는 기록의 시기·제목 등 필수 항목을 입력해 주세요.';return;}await f.onsubmit({preventDefault(){},target:f,auto:true});}

function validate(d){if(!d||d.version!==1||!Array.isArray(d.people)||!Array.isArray(d.events))throw Error('지원하지 않는 기록 형식입니다.');if(d.people.some(p=>typeof p.id!=='string'||typeof p.name!=='string')||d.events.some(e=>typeof e.id!=='string'||typeof e.personId!=='string'||typeof e.title!=='string'||!Array.isArray(e.photos)))throw Error('기록 형식이 손상되었습니다.');return d;}
function githubError(status,detail,remaining,method){
 let reason='GitHub 요청이 실패했습니다.';
 if(status===401)reason='로그인 토큰이 유효하지 않거나 만료됐습니다.';
 else if(status===403||status===429){
  if(remaining==='0'||/rate limit|abuse/i.test(detail))reason='GitHub 요청 한도에 도달했습니다. 잠시 후 다시 저장해 주세요.';
  else if(/resource not accessible/i.test(detail))reason=method==='PUT'?'이 토큰에 family-data 파일 쓰기 권한이 없습니다. Contents를 Read and write로 설정해 주세요.':'이 토큰에 저장소 접근 권한이 없습니다.';
  else reason='GitHub에서 접근을 거부했습니다. 토큰의 저장소 권한 또는 계정 정책을 확인해 주세요.';
 }else if(status===409)reason='다른 기기에서 서버 기록이 변경됐습니다. 현재 입력을 백업한 뒤 최신 기록과 비교해야 합니다.';
 else if(status===422)reason='저장 요청을 GitHub가 처리하지 못했습니다. 아래 상세 원인을 확인해 주세요.';
 else if(status===404)reason='저장소 또는 파일을 찾을 수 없거나 접근 권한이 없습니다.';
 const err=Error('['+status+' / '+method+'] '+reason+(detail?' · '+detail.slice(0,250):''));err.status=status;return err;
}
async function api(path,options={}){
 let r;try{r=await fetch('https://api.github.com/repos/'+session.owner+'/'+session.repo+path,{...options,cache:'no-store',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:'Bearer '+session.token,'X-GitHub-Api-Version':'2022-11-28',...options.headers}});}catch{throw Error('[연결 오류] GitHub 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.');}
 if(!r.ok){let detail='';try{const body=await r.json();detail=typeof body.message==='string'?body.message:'';}catch{}throw githubError(r.status,detail,r.headers.get('x-ratelimit-remaining'),options.method||'GET');}
 return r;
}
async function privateRepo(){const repo=await(await api('')).json();if(repo.private!==true)throw Error('개인 기록은 비공개(Private) 저장소에만 저장할 수 있습니다.');}
async function load(){await privateRepo();try{const r=await(await api('/contents/family.enc.json')).json();sha=r.sha;let envelope;if(r.content)envelope=JSON.parse(new TextDecoder().decode(FamilyCrypto.fromBase64(r.content.replace(/\s/g,''))));else envelope=await(await api('/contents/family.enc.json',{headers:{Accept:'application/vnd.github.raw+json'}})).json();data=validate(await FamilyCrypto.decryptJSON(envelope,session.password));}catch(e){if(e.status!==404)throw e;sha=null;data={version:1,people:[],events:[]};}}
async function save(){if(demo){dirty=false;notice('둘러보기 · 서버에 저장되지 않습니다.');return true;}if(busy)return;busy=true;notice('암호화하여 저장 중…');try{await privateRepo();const envelope=await FamilyCrypto.encryptJSON(data,session.password);let recoveryAvailable=true;try{if(recoveryUnarchived)throw Error('이전 복구본 보존 중');localStorage.setItem('family-recovery:'+session.owner+'/'+session.repo,JSON.stringify({baseSha:sha,envelope}));}catch{recoveryAvailable=false;}const payload={message:'Update encrypted family archive',content:FamilyCrypto.toBase64(new TextEncoder().encode(JSON.stringify(envelope)))};if(sha)payload.sha=sha;const r=await(await api('/contents/family.enc.json',{method:'PUT',body:JSON.stringify(payload)})).json();sha=r.content.sha;dirty=false;try{if(!recoveryUnarchived)localStorage.removeItem('family-recovery:'+session.owner+'/'+session.repo);}catch{}notice('저장 완료 · 비공개 저장소 · '+new Date().toLocaleTimeString('ko-KR')+(recoveryAvailable?'':' · 기기 복구본 저장 공간 부족, 서버 저장은 완료됐습니다.'));return true;}catch(e){notice('저장 실패 · '+e.message+' 입력은 현재 화면에 유지됩니다. 암호화 백업을 내려받으세요.');return false;}finally{busy=false;}}
function enter(){currentView='records';personId=data.people[0]?.id||'';$('#gate').hidden=true;$('#workspace').hidden=false;render();}
function render(){ $('#search').hidden=currentView==='tree';$('#addEvent').hidden=currentView==='tree';$('#relations').classList.toggle('active',currentView==='tree'); $('#people').innerHTML=data.people.map(p=>`<button data-person="${esc(p.id)}" class="${p.id===personId?'active':''}" aria-pressed="${p.id===personId}">${esc(p.name)}</button>`).join('');$('#stages').innerHTML=stages.map(s=>`<button data-stage="${s}" class="nav-btn ${stage===s?'active':''}">${s} <small>${data.events.filter(e=>e.personId===personId&&(s==='전체 기록'||e.stage===s)).length}</small></button>`).join('');$('#personMeta').textContent=person()?.birth?person().birth+' 출생':'한 사람의 삶, 우리 가족의 역사';$('#title').textContent=person()?person().name+' · '+stage:'첫 가족을 등록해 주세요';$('#addEvent').disabled=!person();$('#editPerson').disabled=!person();if(currentView==='tree')renderTree();else renderRecords();}
function sorted(pid){return data.events.filter(e=>e.personId===pid).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));}
function imageMarkup(p){return typeof p.url==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.url)?`<img src="${p.url}" alt="${esc(p.caption||'기록 사진')}" loading="lazy">`:'';}
function renderRecords(){const q=$('#search').value.toLowerCase();const rows=sorted(personId).filter(e=>(stage==='전체 기록'||e.stage===stage)&&[e.title,e.body,e.place].join(' ').toLowerCase().includes(q));$('#records').innerHTML=rows.length?rows.map(e=>`<article class="record"><div class="date">${esc(e.date)} · ${esc(e.stage)}</div><h3>${esc(e.title)}</h3><p class="hint">${esc(e.place)}</p><div class="story">${esc(e.body)}</div><div class="photos">${e.photos.map(imageMarkup).join('')}</div>${e.source?`<p class="hint">자료 출처: ${esc(e.source)}</p>`:''}<button data-event="${esc(e.id)}">기록 수정</button></article>`).join(''):'<div class="empty">아직 이곳에 기록된 이야기가 없어요.<br>출생, 입학, 첫 만남처럼 기억하고 싶은 순간을 남겨보세요.</div>';}
function personEditor(edit=false){resetFormSave();const f=$('#personForm');f.reset();f.querySelector('.formError').textContent='';const p=edit?person():null;for(const k of ['id','name','birth','bio'])f.elements[k].value=p?.[k]||'';const others=data.people.filter(x=>x.id!==p?.id);for(const [container,field,selected] of [['#parentChoices','parents',p?.parents||[]],['#childChoices','children',data.people.filter(x=>(x.parents||[]).includes(p?.id)).map(x=>x.id)]]){
$(container).innerHTML=others.length?others.map(x=>`<label><input type="checkbox" name="${field}" value="${esc(x.id)}" ${selected.includes(x.id)?'checked':''}>${esc(x.name)}</label>`).join(''):'<p class="hint">선택할 다른 가족이 없습니다. 이 인물을 저장한 뒤 ＋ 가족으로 가족을 추가해 주세요.</p>';
}f.elements.spouse.innerHTML='<option value="">선택 안 함</option>'+others.map(x=>`<option value="${esc(x.id)}" ${p?.spouse===x.id?'selected':''}>${esc(x.name)}</option>`).join('');$('#personDialog').showModal();}
function eventEditor(id){resetFormSave();const f=$('#eventForm');f.reset();f.querySelector('.formError').textContent='';const e=data.events.find(x=>x.id===id);f.elements.stage.innerHTML=stages.slice(1).map(s=>`<option>${s}</option>`).join('');for(const k of ['id','date','title','place','body','source'])f.elements[k].value=e?.[k]||'';f.elements.stage.value=e?.stage||(stage==='전체 기록'?'기타':stage);photos=structuredClone(e?.photos||[]);showPhotos();$('#deleteEvent').hidden=!e;$('#eventDialog').showModal();}
function showPhotos(){$('#photoList').innerHTML=photos.map((p,i)=>`<div>${imageMarkup(p)}<button type="button" data-remove-photo="${i}" aria-label="사진 ${i+1} 삭제">삭제</button></div>`).join('');}
async function resize(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('사진은 JPG·PNG·WebP 형식으로 장당 10MB 이하만 가능합니다.');const img=await createImageBitmap(file);const ratio=Math.min(1,1400/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*ratio);c.height=Math.round(img.height*ratio);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close();return {url:c.toDataURL('image/jpeg',.78),caption:file.name};}
$('#login').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;f.querySelector('button').disabled=true;$('#loginError').textContent='';try{session=$('#connectionFields').hidden?await ConnectionVault.unlock(f.elements.password.value):Object.fromEntries(new FormData(f));session.owner=session.owner.trim();session.repo=session.repo.trim();session.token=session.token.trim();demo=false;await load();dirty=false;await prepareRecovery();let rememberError='';try{await ConnectionVault.remember(session);}catch{rememberError=' · 기기 저장이 차단되어 다음 접속 시 토큰을 다시 입력해야 합니다.';}try{if(f.elements.remember.checked)await DeviceLogin.remember(session);else await DeviceLogin.forget();}catch(e){rememberError=' · 이 브라우저에서 로그인 유지 정보를 저장하지 못했습니다.';}f.elements.token.value='';f.elements.password.value='';enter();showRecovery();notice((dirty?'미전송 기록 복구됨 · 저장 다시 시도를 눌러주세요.':'비공개 기록 연결됨')+rememberError);}catch(e){session=null;$('#loginError').textContent=e.message;}finally{f.querySelector('button').disabled=false;}};
$('#demo').onclick=()=>{demo=true;data={version:1,people:[{id:'sample-parent',name:'가족 A (예시)',birth:'1985-04-12',bio:'가상 인물입니다.',parents:[]},{id:'sample-child',name:'가족 B (예시)',birth:'2015-07-03',parents:['sample-parent']}],events:[{id:'sample-event',personId:'sample-parent',date:'1985-04-12',stage:'출생',title:'한 사람의 이야기가 시작되다',place:'예시 장소',body:'이곳에 가족의 기억을 적습니다.\n누가 함께했는지, 어떤 마음이었는지 천천히 기록해 보세요.\n\n이 내용은 사용법 안내를 위한 가상의 예시입니다.',source:'사용법 예시',photos:[]}]};dirty=false;enter();notice('둘러보기 · 가상 기록은 저장되지 않습니다.');};
$('#people').onclick=e=>{const b=e.target.closest('[data-person]');if(b){currentView='records';personId=b.dataset.person;stage='전체 기록';render();}};$('#stages').onclick=e=>{const b=e.target.closest('[data-stage]');if(b){currentView='records';stage=b.dataset.stage;render();}};$('#search').oninput=renderRecords;$('#addPerson').onclick=()=>personEditor();$('#editPerson').onclick=()=>personEditor(true);$('#addEvent').onclick=()=>eventEditor();$('#records').onclick=e=>{const b=e.target.closest('[data-event]');if(b)eventEditor(b.dataset.event);};
function updateFamilyRelations(people,p,children){
 const next=structuredClone(people),i=next.findIndex(x=>x.id===p.id);
 if(i<0)next.push(p);else next[i]=p;
 for(const x of next){if(x.id===p.id)continue;x.parents=(x.parents||[]).filter(id=>id!==p.id);if(children.includes(x.id))x.parents.push(p.id);}
 const byId=new Map(next.map(x=>[x.id,x])),done=new Set(),visiting=new Set();
 function visit(id){if(visiting.has(id))throw Error('같은 사람을 부모와 자녀로 연결할 수 없습니다. 가족 관계를 확인해 주세요.');if(done.has(id))return;visiting.add(id);for(const parent of byId.get(id)?.parents||[])visit(parent);visiting.delete(id);done.add(id);}
 next.forEach(x=>visit(x.id));
 next.forEach(x=>{if(x.id!==p.id&&x.spouse===p.id)x.spouse='';});
 if(p.spouse){const partner=byId.get(p.spouse);if(!partner)throw Error('배우자를 다시 선택해 주세요.');next.forEach(x=>{if(x.id!==p.id&&x.spouse===partner.id)x.spouse='';});partner.spouse=p.id;}
 return next;
}
async function persistForm(f,auto,revision){
 const ok=await save();
 if(ok&&formRevision===revision){formPending=false;if(!auto||closeRequested){closeRequested=false;f.closest('dialog').close();}}
 if(!ok){formPending=true;closeRequested=false;}
 if(formRevision!==revision){formPending=true;clearTimeout(formTimer);formTimer=setTimeout(()=>autosaveForm(f),1800);}
 return ok;
}
$('#personForm').onsubmit=async ev=>{
 ev.preventDefault();if(!ev.auto)closeRequested=true;if(busy||formSaving){if(!formSaving)scheduleFormSave(ev.target);return;}
 const f=ev.target,revision=formRevision;clearTimeout(formTimer);formSaving=true;
 try{const values=new FormData(f),p=Object.fromEntries(values);p.parents=values.getAll('parents');const children=values.getAll('children');delete p.children;p.id=p.id||uid();
 data.people=updateFamilyRelations(data.people,p,children);f.elements.id.value=p.id;personId=p.id;dirty=true;render();f.querySelector('.formError').textContent='';await persistForm(f,ev.auto,revision);
 }catch(e){closeRequested=false;formPending=true;f.querySelector('.formError').textContent=e.message;f.querySelector('.save-status').textContent='저장되지 않았습니다.';}finally{formSaving=false;}
};
$('#eventForm').onsubmit=async ev=>{
 ev.preventDefault();if(!ev.auto)closeRequested=true;if(busy||formSaving){if(!formSaving)scheduleFormSave(ev.target);return;}
 const f=ev.target,revision=formRevision;clearTimeout(formTimer);formSaving=true;const submit=f.querySelector('button.primary');submit.disabled=true;
 try{const e=Object.fromEntries(new FormData(f));
 if(!/^\d{4}(-(?:0[1-9]|1[0-2]))?(-(?:0[1-9]|[12]\d|3[01]))?$/.test(e.date))throw Error('시기를 연도, 연-월 또는 연-월-일로 입력하세요.');
 if(e.date.length===10&&new Date(e.date+'T00:00:00Z').toISOString().slice(0,10)!==e.date)throw Error('존재하지 않는 날짜입니다.');
 const files=[...f.elements.photos.files],added=[];for(const file of files)added.push(await resize(file));
 e.photos=[...photos,...added];e.personId=personId;e.id=e.id||uid();
 const next=structuredClone(data),i=next.events.findIndex(x=>x.id===e.id);if(i<0)next.events.push(e);else next.events[i]=e;
 if(new TextEncoder().encode(JSON.stringify(next)).length>8000000)throw Error('전체 기록 용량이 8MB를 넘습니다. 사진을 줄여주세요.');
 data=next;f.elements.id.value=e.id;photos=e.photos;
 if(files.length===f.elements.photos.files.length&&files.every((file,i)=>file===f.elements.photos.files[i]))f.elements.photos.value='';
 showPhotos();$('#deleteEvent').hidden=false;dirty=true;render();f.querySelector('.formError').textContent='';await persistForm(f,ev.auto,revision);
 }catch(e){closeRequested=false;formPending=true;f.querySelector('.formError').textContent=e.message;f.querySelector('.save-status').textContent='저장되지 않았습니다.';}finally{submit.disabled=false;formSaving=false;}
};
for(const f of [$('#personForm'),$('#eventForm')]){f.addEventListener('input',()=>scheduleFormSave(f));f.addEventListener('change',()=>scheduleFormSave(f));}
async function closeEditor(dialog){
 const f=dialog.querySelector('form');
 if(formSaving||busy){closeRequested=true;notice('서버 저장을 완료한 뒤 창을 닫습니다…');if(!formSaving)scheduleFormSave(f);return;}
 if(formPending||dirty){if(!f.reportValidity())return;closeRequested=true;await f.onsubmit({preventDefault(){},target:f,auto:false});return;}
 clearTimeout(formTimer);closeRequested=false;dialog.close();
}
for(const dialog of [$('#personDialog'),$('#eventDialog')])dialog.addEventListener('cancel',e=>{e.preventDefault();closeEditor(dialog);});
$('#photoList').onclick=e=>{const b=e.target.closest('[data-remove-photo]');if(b){photos.splice(Number(b.dataset.removePhoto),1);showPhotos();scheduleFormSave($('#eventForm'));}};$('#deleteEvent').onclick=async()=>{if(busy||formSaving||!confirm('이 기록을 삭제할까요? 서버에 저장된 이전 버전은 GitHub 기록에 남습니다.'))return;resetFormSave();data.events=data.events.filter(e=>e.id!==$('#eventForm').elements.id.value);dirty=true;$('#eventDialog').close();render();await save();};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeEditor($('#'+b.dataset.close)));
$('#retry').onclick=()=>{const f=document.querySelector('dialog[open] form');if(f&&formPending)autosaveForm(f);else save();};$('#lock').onclick=async()=>{if(busy||formSaving)return;if((dirty||formPending)&&!confirm('미저장 변경이 있습니다. 로그아웃할까요?'))return;try{await DeviceLogin.forget();}catch(e){$('#loginError').textContent='로그인 유지는 해제됐지만 기기 정보 삭제에 실패했습니다. 브라우저의 사이트 데이터를 삭제해 주세요.';}pendingRecovery=null;recoveryUnarchived=false;$('#recoveryNotice').hidden=true;resetFormSave();showConnectionSettings(!ConnectionVault.exists());session=null;data={version:1,people:[],events:[]};photos=[];sha=null;dirty=false;$('#workspace').hidden=true;$('#gate').hidden=false;$('#people').replaceChildren();$('#records').replaceChildren();$('#printArea').replaceChildren();for(const f of [$('#personForm'),$('#eventForm')])f.reset();$('#photoList').replaceChildren();$('#parentChoices').replaceChildren();$('#childChoices').replaceChildren();};
$('#backup').onclick=async()=>{if(demo){alert('실제 비공개 기록에 연결한 뒤 백업할 수 있습니다.');return;}try{const blob=new Blob([JSON.stringify(await FamilyCrypto.encryptJSON(data,session.password))],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='family-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}};
function renderTree(){
  $('#title').textContent='우리 가족 가계도';
  $('#personMeta').textContent='FAMILY TREE';
  const people=data.people, byId=new Map(people.map(p=>[p.id,p])), levels=new Map();
  // Couple groups share one generation and stay adjacent within each row.
  const groups=[],groupOf=new Map();
  for(const p of people){if(groupOf.has(p.id))continue;const members=[p];groupOf.set(p.id,groups.length);
    const spouse=byId.get(p.spouse);if(spouse&&!groupOf.has(spouse.id)){members.push(spouse);groupOf.set(spouse.id,groups.length);}groups.push(members);}
  const ranks=groups.map(()=>0);
  for(let pass=0;pass<groups.length;pass++){let changed=false;
    groups.forEach((members,index)=>{for(const p of members)for(const parent of p.parents||[]){const parentGroup=groupOf.get(parent);if(parentGroup===undefined||parentGroup===index)continue;
      const rank=ranks[parentGroup]+1;if(rank>ranks[index]){ranks[index]=rank;changed=true;}}});if(!changed)break;}
  const rows=new Map(), positions=new Map();
  groups.forEach((members,index)=>{const n=ranks[index];if(!rows.has(n))rows.set(n,[]);for(const p of members){levels.set(p.id,n);rows.get(n).push(p);}});
  const width=Math.max(600,...[...rows.values()].map(row=>row.length*210+40));
  for(const [n,row] of rows)row.forEach((p,i)=>positions.set(p.id,{x:(width-row.length*210)/2+i*210+15,y:35+n*180}));
  const height=Math.max(200,(Math.max(0,...levels.values())+1)*180);
  let edges='',nodes='';const spouses=new Set();
  for(const p of people){const a=positions.get(p.id);
    for(const id of p.parents||[]){const b=positions.get(id);if(!b)continue;
      const mid=(b.y+84+a.y)/2;
      edges+=`<path class="parent-line" d="M ${b.x+90} ${b.y+84} V ${mid} H ${a.x+90} V ${a.y}"><title>${esc(byId.get(id).name)} → ${esc(p.name)} (부모·자녀)</title></path>`;
    }
    const b=positions.get(p.spouse),key=[p.id,p.spouse].sort().join('|');
    if(b&&!spouses.has(key)){spouses.add(key);edges+=`<path class="spouse-line" d="M ${a.x+90} ${a.y+42} L ${b.x+90} ${b.y+42}"><title>${esc(p.name)} · ${esc(byId.get(p.spouse).name)} (배우자)</title></path>`;}
    nodes+=`<g class="tree-person ${p.id===personId?'selected':''}" data-tree-person="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(p.name)} 인물 정보 수정"><rect x="${a.x}" y="${a.y}" width="180" height="84" rx="12"/><text x="${a.x+90}" y="${a.y+34}" text-anchor="middle">${esc(p.name.length>11?p.name.slice(0,10)+'…':p.name)}</text><text class="tree-birth" x="${a.x+90}" y="${a.y+60}" text-anchor="middle">${esc(p.birth||'출생일 미등록')}</text><title>${esc(p.name)}</title></g>`;
  }
  const name=id=>byId.get(id)?.name||'미등록';
  $('#records').innerHTML=people.length?`<p class="hint">실선: 부모·자녀 · 점선: 배우자<br>인물을 누르면 관계를 수정할 수 있습니다. 넓은 가계도는 좌우로 스크롤하세요.</p><div class="tree-scroll" tabindex="0" aria-label="가계도 스크롤 영역"><svg class="family-tree" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="우리 가족 가계도">${edges}${nodes}</svg></div><details class="tree-details"><summary>가족 관계를 글로 보기</summary>${people.map(p=>`<article class="relation"><h3>${esc(p.name)}</h3><p>부모: ${esc((p.parents||[]).map(name).join(', ')||'미등록')}</p><p>배우자: ${esc(name(p.spouse))}</p><p>자녀: ${esc(people.filter(x=>(x.parents||[]).includes(p.id)).map(x=>x.name).join(', ')||'미등록')}</p></article>`).join('')}</details>`:'<div class="empty">＋ 가족 버튼으로 아버지·어머니와 가족을 등록해 주세요.<br>자녀의 인물 정보에서 부모를 선택하면 선으로 연결됩니다.</div>';
}
$('#relations').onclick=()=>{currentView='tree';render();};
function editTreePerson(target){const node=target.closest('[data-tree-person]');if(!node)return;personId=node.dataset.treePerson;render();personEditor(true);}
$('#records').addEventListener('click',e=>editTreePerson(e.target));
$('#records').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-tree-person]')){e.preventDefault();editTreePerson(e.target);}});
$('#book').onclick=()=>{if(!data.people.length)return;$('#printArea').innerHTML='<h1>우리 가족의 시간</h1><p>가족의 삶과 기억을 모은 기록집</p>'+data.people.map(p=>`<section class="chapter"><h1>${esc(p.name)}</h1><p>${esc(p.birth||'')}</p><div class="story">${esc(p.bio||'')}</div>${sorted(p.id).map(e=>`<article><h2>${esc(e.date)} · ${esc(e.title)}</h2><p>${esc(e.place)}</p><div class="story">${esc(e.body)}</div>${e.photos.map(imageMarkup).join('')}<p>${esc(e.source||'')}</p></article>`).join('')}</section>`).join('');window.print();$('#printArea').replaceChildren();};
window.addEventListener('beforeunload',e=>{if(dirty||formPending||formSaving){e.preventDefault();e.returnValue='';}});

function showConnectionSettings(show){
 $('#connectionFields').hidden=!show;
 for(const k of ['owner','repo','token'])$('#login').elements[k].required=show;
 $('#connectionSettings').textContent=show&&ConnectionVault.exists()?'비밀번호로 로그인':'저장소 연결 설정';
}
$('#connectionSettings').onclick=()=>showConnectionSettings($('#connectionFields').hidden||!ConnectionVault.exists());
async function restoreDeviceLogin(){
 const f=$('#login'),button=f.querySelector('button');button.disabled=true;$('#demo').disabled=true;
 try{showConnectionSettings(!ConnectionVault.exists());const remembered=await DeviceLogin.restore();if(!remembered)return;
 showConnectionSettings(true);
 for(const k of ['owner','repo','token','password'])f.elements[k].value=remembered[k];
 f.elements.remember.checked=true;$('#loginError').textContent='저장된 정보로 자동 연결 중…';
 await f.onsubmit({preventDefault(){},target:f});
 }catch(e){$('#loginError').textContent='기록 비밀번호를 입력해 주세요. 자동 로그인을 사용할 수 없습니다.';}
 finally{showConnectionSettings(!ConnectionVault.exists());f.elements.token.value='';f.elements.password.value='';button.disabled=false;$('#demo').disabled=false;}
}

let pendingRecovery=null,recoveryUnarchived=false;
async function prepareRecovery(){
 pendingRecovery=null;recoveryUnarchived=false;
 const key='family-recovery:'+session.owner+'/'+session.repo,archive=key+':preserved';
 let raw=null;try{raw=localStorage.getItem(key);if(raw){
   // Keep every unresolved snapshot; never let a later save erase it.
   const previous=localStorage.getItem(archive);if(previous&&previous!==raw)localStorage.setItem(archive+':'+Date.now(),previous);
   localStorage.setItem(archive,raw);localStorage.removeItem(key);
 }else raw=localStorage.getItem(archive);
 }catch{recoveryUnarchived=!!raw;}
 if(!raw)return;
 try{const saved=JSON.parse(raw);pendingRecovery={...saved,raw};}catch{pendingRecovery={raw};}
}
function showRecovery(){
 $('#recoveryNotice').hidden=!pendingRecovery;
 if(!pendingRecovery)return;
 $('#restoreRecovery').disabled=!pendingRecovery.envelope||pendingRecovery.baseSha!==sha;
 $('#recoveryMessage').textContent=pendingRecovery.baseSha===sha?'이 기기에 미저장 복구본이 있습니다. 현재는 서버 기록을 표시합니다. 필요할 때 복구하거나 백업하세요.':'이 기기에 이전 미저장 복구본이 있습니다. 최신 서버 기록을 보호하기 위해 자동으로 덮어쓰지 않습니다. 복구본을 내려받을 수 있습니다.';
}
$('#downloadRecovery').onclick=()=>{if(!pendingRecovery)return;const blob=new Blob([pendingRecovery.envelope?JSON.stringify(pendingRecovery.envelope):pendingRecovery.raw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='family-unsent-backup-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#restoreRecovery').onclick=async()=>{if(busy||formSaving||!pendingRecovery||pendingRecovery.baseSha!==sha)return;if(dirty){notice('현재 변경사항을 먼저 저장하거나 백업해 주세요.');return;}try{data=validate(await FamilyCrypto.decryptJSON(pendingRecovery.envelope,session.password));dirty=true;render();notice('복구본을 화면에 불러왔습니다. 확인 후 저장 다시 시도를 눌러 서버에 저장하세요.');}catch(e){notice('복구 실패 · '+e.message);}};

restoreDeviceLogin();
