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
function render(){ $('#search').hidden=currentView!=='records';$('#addEvent').hidden=currentView!=='records';$('#relations').classList.toggle('active',currentView==='tree');$('#book').classList.toggle('active',currentView==='book'); $('#people').innerHTML=data.people.map(p=>`<button data-person="${esc(p.id)}" class="${p.id===personId?'active':''}" aria-pressed="${p.id===personId}">${esc(p.name)}</button>`).join('');$('#stages').innerHTML=stages.map(s=>`<button data-stage="${s}" class="nav-btn ${stage===s?'active':''}">${s} <small>${data.events.filter(e=>e.personId===personId&&(s==='전체 기록'||e.stage===s)).length}</small></button>`).join('');$('#personMeta').textContent=person()?.birth?person().birth+' 출생':'한 사람의 삶, 우리 가족의 역사';$('#title').textContent=person()?person().name+' · '+stage:'첫 가족을 등록해 주세요';$('#addEvent').disabled=!person();$('#editPerson').disabled=!person();if(currentView==='tree')renderTree();else if(currentView==='book')renderBook();else renderRecords();}
function sorted(pid){return data.events.filter(e=>e.personId===pid).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));}
function imageMarkup(p){return typeof p.url==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.url)?`<img src="${p.url}" alt="${esc(p.caption||'기록 사진')}" loading="lazy">`:'';}
function renderRecords(){const q=$('#search').value.toLowerCase();const rows=sorted(personId).filter(e=>(stage==='전체 기록'||e.stage===stage)&&[e.title,e.body,e.place].join(' ').toLowerCase().includes(q));$('#records').innerHTML=rows.length?rows.map(e=>`<article class="record"><div class="date">${esc(e.date)} · ${esc(e.stage)}</div><h3>${esc(e.title)}</h3><p class="hint">${esc(e.place)}</p><div class="story">${esc(e.body)}</div><div class="photos">${e.photos.map(imageMarkup).join('')}</div>${e.source?`<p class="hint">자료 출처: ${esc(e.source)}</p>`:''}<button data-event="${esc(e.id)}">기록 수정</button></article>`).join(''):'<div class="empty">아직 이곳에 기록된 이야기가 없어요.<br>출생, 입학, 첫 만남처럼 기억하고 싶은 순간을 남겨보세요.</div>';}
function personEditor(edit=false){resetFormSave();const f=$('#personForm');f.reset();f.querySelector('.formError').textContent='';const p=edit?person():null;for(const k of ['id','name','gender','birth','bio'])f.elements[k].value=p?.[k]||'';const others=data.people.filter(x=>x.id!==p?.id);for(const [container,field,selected] of [['#parentChoices','parents',p?.parents||[]],['#siblingChoices','siblings',p?.siblings||[]],['#childChoices','children',data.people.filter(x=>(x.parents||[]).includes(p?.id)).map(x=>x.id)]]){
$(container).innerHTML=others.length?others.map(x=>`<label><input type="checkbox" name="${field}" value="${esc(x.id)}" ${selected.includes(x.id)?'checked':''}>${esc(x.name)}</label>`).join(''):'<p class="hint">선택할 다른 가족이 없습니다. 이 인물을 저장한 뒤 ＋ 가족으로 가족을 추가해 주세요.</p>';
}f.elements.spouse.innerHTML='<option value="">선택 안 함</option>'+others.map(x=>`<option value="${esc(x.id)}" ${p?.spouse===x.id?'selected':''}>${esc(x.name)}</option>`).join('');$('#personDialog').showModal();}
function eventEditor(id){resetFormSave();const f=$('#eventForm');f.reset();f.querySelector('.formError').textContent='';const e=data.events.find(x=>x.id===id);f.elements.stage.innerHTML=stages.slice(1).map(s=>`<option>${s}</option>`).join('');for(const k of ['id','date','title','place','body','source'])f.elements[k].value=e?.[k]||'';f.elements.stage.value=e?.stage||(stage==='전체 기록'?'기타':stage);photos=structuredClone(e?.photos||[]);showPhotos();$('#deleteEvent').hidden=!e;$('#eventDialog').showModal();}
function showPhotos(){$('#photoList').innerHTML=photos.map((p,i)=>`<div>${imageMarkup(p)}<button type="button" data-remove-photo="${i}" aria-label="사진 ${i+1} 삭제">삭제</button></div>`).join('');}
async function resize(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('사진은 JPG·PNG·WebP 형식으로 장당 10MB 이하만 가능합니다.');const img=await createImageBitmap(file);const ratio=Math.min(1,1400/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*ratio);c.height=Math.round(img.height*ratio);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close();return {url:c.toDataURL('image/jpeg',.78),caption:file.name};}
$('#login').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;f.querySelector('button').disabled=true;$('#loginError').textContent='';try{session=$('#connectionFields').hidden?await ConnectionVault.unlock(f.elements.password.value):Object.fromEntries(new FormData(f));session.owner=session.owner.trim();session.repo=session.repo.trim();session.token=session.token.trim();demo=false;await load();dirty=false;await prepareRecovery();let rememberError='';try{await ConnectionVault.remember(session);}catch{rememberError=' · 기기 저장이 차단되어 다음 접속 시 토큰을 다시 입력해야 합니다.';}try{if(f.elements.remember.checked)await DeviceLogin.remember(session);else await DeviceLogin.forget();}catch(e){rememberError=' · 이 브라우저에서 로그인 유지 정보를 저장하지 못했습니다.';}f.elements.token.value='';f.elements.password.value='';enter();showRecovery();notice((dirty?'미전송 기록 복구됨 · 저장 다시 시도를 눌러주세요.':'비공개 기록 연결됨')+rememberError);if(!dirty)globalThis.checkInbox?.();}catch(e){session=null;$('#loginError').textContent=e.message;}finally{f.querySelector('button').disabled=false;}};
$('#demo').onclick=()=>{demo=true;data={version:1,people:[{id:'sample-parent',name:'가족 A (예시)',birth:'1985-04-12',bio:'가상 인물입니다.',parents:[]},{id:'sample-child',name:'가족 B (예시)',birth:'2015-07-03',parents:['sample-parent']}],events:[{id:'sample-event',personId:'sample-parent',date:'1985-04-12',stage:'출생',title:'한 사람의 이야기가 시작되다',place:'예시 장소',body:'이곳에 가족의 기억을 적습니다.\n누가 함께했는지, 어떤 마음이었는지 천천히 기록해 보세요.\n\n이 내용은 사용법 안내를 위한 가상의 예시입니다.',source:'사용법 예시',photos:[]}]};dirty=false;enter();notice('둘러보기 · 가상 기록은 저장되지 않습니다.');};
$('#people').onclick=e=>{const b=e.target.closest('[data-person]');if(b){personId=b.dataset.person;stage='전체 기록';if(currentView==='book')currentView='records';render();}};$('#stages').onclick=e=>{const b=e.target.closest('[data-stage]');if(b){currentView='records';stage=b.dataset.stage;render();}};$('#search').oninput=renderRecords;$('#addPerson').onclick=()=>personEditor();$('#editPerson').onclick=()=>personEditor(true);$('#addEvent').onclick=()=>eventEditor();$('#records').onclick=e=>{if(e.target.closest('#printBook')){printBook();return;}const b=e.target.closest('[data-event]');if(b)eventEditor(b.dataset.event);};
function updateFamilyRelations(people,p,children){
 const next=structuredClone(people),i=next.findIndex(x=>x.id===p.id);
 if(i<0)next.push(p);else next[i]=p;
 for(const x of next){if(x.id===p.id)continue;x.parents=(x.parents||[]).filter(id=>id!==p.id);if(children.includes(x.id))x.parents.push(p.id);}
 // 형제자매는 서로 연결합니다. 부모가 등록되지 않아도 가계도에서 나란히 놓입니다.
 if(Array.isArray(p.siblings))for(const x of next){if(x.id===p.id)continue;const had=(x.siblings||[]).includes(p.id);x.siblings=(x.siblings||[]).filter(id=>id!==p.id);if(p.siblings.includes(x.id))x.siblings.push(p.id);else if(had&&!x.siblings.length)delete x.siblings;}
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
 try{const values=new FormData(f),p=Object.fromEntries(values);p.parents=values.getAll('parents');p.siblings=values.getAll('siblings').filter(id=>id!==p.id);const children=values.getAll('children');delete p.children;p.id=p.id||uid();
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
$('#retry').onclick=()=>{const f=document.querySelector('dialog[open] form');if(f&&formPending)autosaveForm(f);else save();};$('#lock').onclick=async()=>{if(busy||formSaving)return;if((dirty||formPending)&&!confirm('미저장 변경이 있습니다. 로그아웃할까요?'))return;try{await DeviceLogin.forget();}catch(e){$('#loginError').textContent='로그인 유지는 해제됐지만 기기 정보 삭제에 실패했습니다. 브라우저의 사이트 데이터를 삭제해 주세요.';}pendingRecovery=null;recoveryUnarchived=false;$('#recoveryNotice').hidden=true;resetFormSave();showConnectionSettings(!ConnectionVault.exists());session=null;data={version:1,people:[],events:[]};photos=[];sha=null;dirty=false;$('#workspace').hidden=true;$('#gate').hidden=false;$('#people').replaceChildren();$('#records').replaceChildren();$('#printArea').replaceChildren();for(const f of [$('#personForm'),$('#eventForm')])f.reset();$('#photoList').replaceChildren();$('#parentChoices').replaceChildren();$('#childChoices').replaceChildren();$('#siblingChoices').replaceChildren();};
$('#backup').onclick=async()=>{if(demo){alert('실제 비공개 기록에 연결한 뒤 백업할 수 있습니다.');return;}try{const blob=new Blob([JSON.stringify(await FamilyCrypto.encryptJSON(data,session.password))],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='family-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}};
// Solve generations in both directions so a shorter ancestral branch is not
// incorrectly placed above a longer branch. Spouses occupy a single block with
// the husband on the left and the wife on the right.
function treeGender(p,byId){if(p.gender==='M'||p.gender==='F')return p.gender;const s=byId.get(p.spouse);return s?.gender==='M'?'F':s?.gender==='F'?'M':'';}
// 친가/외가: pick the parents of the selected person (or, failing that, the couple
// with the most recorded relatives on both sides) and mark each side's relatives:
// ancestors, siblings (also those linked only as 형제자매), their families and spouses.
function familySides(people,byId,focusId,parentsOf,siblingsOf){
 const childrenOf=new Map();for(const p of people)for(const id of parentsOf.get(p.id)||[]){if(!childrenOf.has(id))childrenOf.set(id,[]);childrenOf.get(id).push(p.id);}
 const walk=(start,next)=>{const out=new Set(),todo=[...start];while(todo.length){const id=todo.pop();if(out.has(id))continue;out.add(id);todo.push(...next(id));}return out;};
 const up=id=>parentsOf.get(id)||[],down=id=>childrenOf.get(id)||[];
 const side=(parent,line)=>{const kin=walk([parent.id,...(siblingsOf.get(parent.id)||[])],id=>[...up(id),...(siblingsOf.get(id)||[])]);
  const set=walk([...kin].filter(id=>id!==parent.id),down);for(const id of line)set.delete(id);set.add(parent.id);
  for(const id of [...set]){const s=byId.get(id).spouse;if(byId.has(s)&&!line.has(s))set.add(s);}return set;};
 const couple=child=>{const ps=[...new Set(parentsOf.get(child.id)||[])].map(id=>byId.get(id)).filter(Boolean);if(ps.length!==2)return null;
  let [father,mother]=ps;if(treeGender(father,byId)==='F'||treeGender(mother,byId)==='M')[father,mother]=[mother,father];
  if(treeGender(father,byId)!=='M'&&treeGender(mother,byId)!=='F')return null;
  const line=walk([father.id,mother.id],down),paternal=side(father,line),maternal=side(mother,line);
  return paternal.size+maternal.size>2?{father,mother,paternal,maternal,score:paternal.size+maternal.size}:null;};
 let best=null;
 // One fixed point of view (the couple with the most relatives on both sides), so the
 // sides do not jump around when another person is selected.
 for(const p of people){const c=couple(p);if(c&&(!best||c.score>best.score))best=c;}
 if(!best)return null;
 const {father,mother,paternal,maternal}=best;
 for(const id of [...paternal])if(maternal.has(id)&&id!==father.id&&id!==mother.id){paternal.delete(id);maternal.delete(id);}
 maternal.delete(father.id);paternal.delete(mother.id);
 return {father,mother,paternal,maternal};
}
function familyTreeLayout(people,focusId){
 const byId=new Map(people.map(p=>[p.id,p])),root=new Map(people.map(p=>[p.id,p.id]));
 const find=id=>{while(root.get(id)!==id)id=root.get(id);return id;};
 for(const p of people)if(byId.has(p.spouse)&&p.spouse!==p.id)root.set(find(p.spouse),find(p.id));
 const groups=[],groupOf=new Map(),groupByRoot=new Map();
 for(const p of people){const r=find(p.id);if(!groupByRoot.has(r)){groupByRoot.set(r,groups.length);groups.push({members:[],neighbors:[],rank:0,x:0,side:0});}const i=groupByRoot.get(r);groups[i].members.push(p);groupOf.set(p.id,i);}
 // Siblings linked directly (without registered parents) share the parents any
 // of them has; if none has parents they are still kept in one generation, side by side.
 const sibRoot=new Map(people.map(p=>[p.id,p.id])),sfind=id=>{while(sibRoot.get(id)!==id)id=sibRoot.get(id);return id;};
 for(const p of people)for(const id of p.siblings||[])if(byId.has(id)&&id!==p.id)sibRoot.set(sfind(id),sfind(p.id));
 const clusters=new Map();for(const p of people){const r=sfind(p.id);if(!clusters.has(r))clusters.set(r,[]);clusters.get(r).push(p.id);}
 const siblingsOf=new Map(),effective=new Map(),inherited=new Set();
 for(const ids of clusters.values()){const shared=ids.map(id=>[...new Set(byId.get(id).parents||[])].filter(x=>byId.has(x)&&x!==id)).find(ps=>ps.length)||[];
  for(const id of ids){if(ids.length>1)siblingsOf.set(id,ids.filter(x=>x!==id));const own=[...new Set(byId.get(id).parents||[])].filter(x=>byId.has(x)&&x!==id);
   const use=own.length?own:shared.filter(x=>!ids.includes(x));if(!own.length&&use.length)inherited.add(id);effective.set(id,use);}}
 const order={M:0,'':1,F:2};for(const g of groups)g.members.sort((a,b)=>order[treeGender(a,byId)]-order[treeGender(b,byId)]);
 const links=[],seen=new Set(),warnings=[],parentsOf=new Map(),childrenOf=new Map();
 for(const child of people)if((child.parents||[]).some(id=>!byId.has(id)))warnings.push(child.name+'의 부모 정보에 등록되지 않은 인물이 있습니다.');
 for(const child of people)for(const id of effective.get(child.id)){
  const from=groupOf.get(id),to=groupOf.get(child.id),key=from+':'+to;
  if(from===to){warnings.push(byId.get(id).name+' · '+child.name+': 배우자와 부모·자녀 관계가 겹칩니다.');continue;}
  if(!parentsOf.has(child.id))parentsOf.set(child.id,[]);parentsOf.get(child.id).push(id);
  if(!childrenOf.has(id))childrenOf.set(id,[]);childrenOf.get(id).push(child.id);
  if(seen.has(key))continue;seen.add(key);links.push({from,to});
  groups[from].neighbors.push({id:to,delta:1});groups[to].neighbors.push({id:from,delta:-1});
 }
 for(const [id,sibs] of siblingsOf)for(const other of sibs){const a=groupOf.get(id),b=groupOf.get(other);if(a!==b&&!groups[a].neighbors.some(n=>n.id===b&&n.delta===0))groups[a].neighbors.push({id:b,delta:0});}
 const sides=familySides(people,byId,focusId,parentsOf,siblingsOf);
 if(sides)for(const g of groups){const pat=g.members.some(p=>sides.paternal.has(p.id)),mat=g.members.some(p=>sides.maternal.has(p.id));g.side=pat&&!mat?-1:mat&&!pat?1:0;}
 // Centre of one person's box, so a husband's parents sit above the husband
 // (left) and a wife's parents above the wife (right).
 const px=id=>{const g=groups[groupOf.get(id)];return g.x-g.members.length*105+g.members.indexOf(byId.get(id))*210+105;};
 const visited=new Set(),components=[];
 for(let seed=0;seed<groups.length;seed++){
  if(visited.has(seed))continue;const ids=[seed];visited.add(seed);groups[seed].rank=0;
  for(let q=0;q<ids.length;q++){const i=ids[q];for(const n of groups[i].neighbors){
   if(!visited.has(n.id)){visited.add(n.id);groups[n.id].rank=groups[i].rank+n.delta;ids.push(n.id);}
   else if(groups[n.id].rank!==groups[i].rank+n.delta)warnings.push('일부 부모·자녀 연결의 세대가 일치하지 않습니다. 인물 정보에서 관계를 확인해 주세요.');
  }}
  const min=Math.min(...ids.map(i=>groups[i].rank));ids.forEach(i=>groups[i].rank-=min);
  const rows=new Map();for(const i of ids){const rank=groups[i].rank;if(!rows.has(rank))rows.set(rank,[]);rows.get(rank).push(i);}
  const ranks=[...rows.keys()].sort((a,b)=>a-b);
  const arrange=()=>{const widest=Math.max(...[...rows.values()].map(row=>row.reduce((s,i)=>s+groups[i].members.length*210,0)+(row.length-1)*60));
   for(const row of rows.values()){const total=row.reduce((s,i)=>s+groups[i].members.length*210,0)+(row.length-1)*60;let x=(widest-total)/2;for(const i of row){const w=groups[i].members.length*210;groups[i].x=x+w/2;x+=w+60;}}
   return widest;
  };
  // Keep siblings and their partners together, then order ancestral branches
  // toward their descendants. 친가 stays left of 외가 in every row.
  let width=arrange();
  // End with a downward sweep so every row is ordered under its own parents:
  // a husband's siblings stay under his parents (left), a wife's under hers (right).
  for(let pass=0;pass<9;pass++){
   const down=pass%2===0;
   for(const rank of down?ranks:[...ranks].reverse()){
    // Only groups with relatives in the sweep direction move; the others keep their
    // slot, so positions measured in different rows are never compared directly.
    const row=rows.get(rank),bary=new Map();
    for(const i of row){const xs=groups[i].members.flatMap(p=>{const rel=(down?parentsOf:childrenOf).get(p.id)||[];if(rel.length)return rel;return (parentsOf.get(p.id)||[]).length?[]:(siblingsOf.get(p.id)||[]).filter(x=>groupOf.get(x)!==i);}).map(px);if(xs.length)bary.set(i,xs.reduce((s,x)=>s+x,0)/xs.length);}
    const slots=row.map((i,k)=>bary.has(i)?k:-1).filter(k=>k>=0),movable=slots.map(k=>row[k]).sort((a,b)=>bary.get(a)-bary.get(b));
    slots.forEach((k,j)=>row[k]=movable[j]);row.sort((a,b)=>groups[a].side-groups[b].side);arrange();
   }
  }
  width=arrange();
  // Place each row under its parents (and parents over their children) while keeping
  // the order and a fixed gap, so family lines of different branches do not cross.
  const offset=(g,p)=>-g.members.length*105+g.members.indexOf(p)*210+105;
  const target=(i,down)=>{const g=groups[i],ts=[];for(const p of g.members){const rel=(down?parentsOf:childrenOf).get(p.id)||[];if(rel.length)ts.push(rel.reduce((s,id)=>s+px(id),0)/rel.length-(down?offset(g,p):0));}return ts.length?ts.reduce((s,x)=>s+x,0)/ts.length:null;};
  const place=(row,want)=>{const half=i=>groups[i].members.length*105,l=[],r=[];
   row.forEach((i,k)=>{const prev=k?l[k-1]+half(row[k-1])+60+half(i):-Infinity;l[k]=Math.max(want[k]??prev,prev);});
   for(let k=row.length-1;k>=0;k--){const i=row[k],next=k<row.length-1?r[k+1]-half(row[k+1])-60-half(i):Infinity;r[k]=Math.min(want[k]??next,next);}
   row.forEach((i,k)=>{const a=l[k],b=r[k];groups[i].x=Number.isFinite(a)&&Number.isFinite(b)?(a+b)/2:Number.isFinite(a)?a:b;});
   // Rows with no wishes at all keep their centred placement.
  };
  for(let pass=0;pass<6;pass++){const down=pass%2===0||pass===5;
   for(const rank of down?ranks:[...ranks].reverse()){const row=rows.get(rank),want=row.map(i=>target(i,down));if(want.every(w=>w==null))continue;
    // Fill gaps for groups without a wish next to their neighbours.
    place(row,want);}}
  const left=Math.min(...ids.map(i=>groups[i].x-groups[i].members.length*105));ids.forEach(i=>groups[i].x-=left);
  width=Math.max(...ids.map(i=>groups[i].x+groups[i].members.length*105));
  components.push({ids,width:width+70,height:(Math.max(...ranks)+1)*200+80,rows});
 }
 // Connected family branches first; relatives without saved links remain visible
 // in their own panel rather than being assigned a misleading generation.
 components.sort((a,b)=>b.ids.length-a.ids.length);
 const positions=new Map();let offsetY=0,width=460;
 for(const c of components){
  c.top=offsetY;for(const i of c.ids){const g=groups[i],start=g.x-g.members.length*210/2+50;g.members.forEach((p,k)=>positions.set(p.id,{x:start+k*210,y:offsetY+55+g.rank*200,group:i}));}
  offsetY+=c.height+30;width=Math.max(width,c.width);
 }
 return {groups,groupOf,positions,components,sides,parentsOf,siblingsOf,inherited,width,height:Math.max(200,offsetY),warnings:[...new Set(warnings)]};
}
let treeScale='fit';
function renderTree(){
 $('#title').textContent='우리 가족 전체 가계도';$('#personMeta').textContent='전체 가족 · 부모 · 배우자 · 자녀';
 if(!data.people.length){$('#records').innerHTML='<div class="empty">＋ 가족 버튼으로 가족을 등록해 주세요.</div>';return;}
 const people=data.people,byId=new Map(people.map(p=>[p.id,p])),layout=familyTreeLayout(people,personId),{positions,width,height}=layout;
 let edges='',nodes='',panels='';const spouseSeen=new Set(),families=new Map();
 for(const c of layout.components)if(layout.components.length>1){const label=c.ids.length===1&&layout.groups[c.ids[0]].members.length===1?'관계 미연결':'가족 관계';panels+=`<text x="35" y="${c.top+25}" fill="#67778d" font-size="14">${label}</text>`;}
 for(const child of people){
  const parents=layout.parentsOf.get(child.id)||[];
  if(!parents.length)continue;const key=[...parents].sort().join('|');if(!families.has(key))families.set(key,{parents,children:[]});families.get(key).children.push(child);
 }
 const bracketSeen=new Set();
 for(const [id,sibs] of layout.siblingsOf){const ids=[id,...sibs].filter(x=>!(layout.parentsOf.get(x)||[]).length);const key=[...ids].sort().join('|');if(ids.length<2||bracketSeen.has(key))continue;bracketSeen.add(key);
  const ps=ids.map(x=>positions.get(x)).filter(p=>p.y===positions.get(ids[0]).y);if(ps.length<2)continue;const y=ps[0].y-16,xs=ps.map(p=>p.x+90);
  edges+=`<path class="sibling-line" d="M ${Math.min(...xs)} ${y} H ${Math.max(...xs)} ${xs.map(x=>`M ${x} ${y} V ${ps[0].y}`).join(' ')}"><title>${esc(ids.map(x=>byId.get(x).name).join(' · '))} (형제자매)</title></path>`;}
 const laneByRank=new Map();
 for(const family of families.values()){
  const parentPositions=family.parents.map(id=>positions.get(id)),childPositions=family.children.map(p=>positions.get(p.id));
  const bottom=Math.max(...parentPositions.map(p=>p.y+84)),top=Math.min(...childPositions.map(p=>p.y));
  if(top<=bottom)continue; // Inconsistent links are listed in the warning, not drawn backward.
  const lane=laneByRank.get(bottom)||0;laneByRank.set(bottom,lane+1);
  const parentXs=parentPositions.map(p=>p.x+90),childXs=childPositions.map(p=>p.x+90);
  const junction=parentXs.reduce((a,b)=>a+b,0)/parentXs.length,joinY=bottom+18,busY=bottom+48+(lane%5)*9;
  const title=esc(family.parents.map(id=>byId.get(id).name).join(' · ')+' → '+family.children.map(p=>p.name).join(', ')+' (부모·자녀)');
  let path='';
  for(const p of parentPositions)path+=`M ${p.x+90} ${p.y+84} V ${joinY} `;
  path+=`M ${Math.min(...parentXs)} ${joinY} H ${Math.max(...parentXs)} M ${junction} ${joinY} V ${busY} M ${Math.min(junction,...childXs)} ${busY} H ${Math.max(junction,...childXs)} `;
  for(const p of childPositions)path+=`M ${p.x+90} ${busY} V ${p.y} `;
  edges+=`<path class="parent-line" d="${path}"><title>${title}</title></path>`;
 }
 for(const p of people){
  const a=positions.get(p.id),partner=byId.get(p.spouse),b=positions.get(p.spouse),key=[p.id,p.spouse].sort().join('|');
  if(b&&p.id!==p.spouse&&!spouseSeen.has(key)){spouseSeen.add(key);const left=a.x<b.x?a:b,right=a.x<b.x?b:a;edges+=`<path class="spouse-line" d="M ${left.x+180} ${left.y+42} H ${right.x}"><title>${esc(p.name)} · ${esc(partner.name)} (배우자)</title></path>`;}
  nodes+=`<g class="tree-person ${p.id===personId?'selected':''} ${layout.sides?.paternal.has(p.id)?'side-paternal':layout.sides?.maternal.has(p.id)?'side-maternal':''}" data-tree-person="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(p.name)} 인물 정보 수정"><rect x="${a.x}" y="${a.y}" width="180" height="84" rx="12"/><text x="${a.x+90}" y="${a.y+34}" text-anchor="middle">${esc(p.name.length>11?p.name.slice(0,10)+'…':p.name)}</text><text class="tree-birth" x="${a.x+90}" y="${a.y+60}" text-anchor="middle">${esc(p.birth||'출생일 미등록')}</text><title>${esc(p.name)}</title></g>`;
 }
 if(layout.sides)for(const [set,label,cls] of [[layout.sides.paternal,'친가 · '+layout.sides.father.name+' 쪽','side-paternal'],[layout.sides.maternal,'외가 · '+layout.sides.mother.name+' 쪽','side-maternal']]){
  const ps=[...set].map(id=>positions.get(id)),top=Math.min(...ps.map(p=>p.y)),row=ps.filter(p=>p.y===top),x=(Math.min(...row.map(p=>p.x))+Math.max(...row.map(p=>p.x))+180)/2;
  panels+=`<text class="side-label ${cls}" x="${x}" y="${top-26}" text-anchor="middle">${esc(label)}</text>`;
 }
 const warnings=layout.warnings.length?`<p role="status" class="formError">${layout.warnings.map(esc).join('<br>')}</p>`:'';
 const name=id=>byId.get(id)?.name||'미등록';
 const available=$('#records').clientWidth||900,scale=treeScale==='fit'?Math.min(1,available/width):treeScale;
 $('#records').innerHTML=`<p class="hint">전체 가족을 표시합니다. 부부는 같은 높이에 남편 왼쪽·아내 오른쪽, 부모·자녀는 한 세대 간격으로 배치합니다. 친가는 왼쪽, 외가는 오른쪽에 색을 나눠 표시합니다(인물 정보에 성별을 입력해 주세요).<br>실선: 부모·자녀 · 점선: 배우자 · 위쪽 묶음선: 형제자매(부모 미등록) · 인물을 누르면 정보를 수정할 수 있습니다.</p><div class="actions"><button type="button" data-tree-zoom="fit">화면에 맞추기</button><button type="button" data-tree-zoom="in" aria-label="가계도 확대">확대</button><button type="button" data-tree-zoom="out" aria-label="가계도 축소">축소</button></div>${warnings}<div class="tree-scroll" style="margin-top:12px;max-height:75vh" tabindex="0" aria-label="가계도 스크롤 영역"><svg class="family-tree" width="${width*scale}" height="${height*scale}" viewBox="0 0 ${width} ${height}" aria-label="우리 가족 전체 가계도">${panels}${edges}${nodes}</svg></div><details class="tree-details"><summary>가족 관계를 글로 보기</summary>${people.map(p=>`<article class="relation"><h3>${esc(p.name)}</h3><p>부모: ${esc((p.parents||[]).map(name).join(', ')||'미등록')}</p><p>배우자: ${esc(name(p.spouse))}</p><p>형제자매: ${esc((layout.siblingsOf.get(p.id)||[]).map(name).join(', ')||'미등록')}</p><p>자녀: ${esc(people.filter(x=>(x.parents||[]).includes(p.id)).map(x=>x.name).join(', ')||'미등록')}</p></article>`).join('')}</details>`;
}
$('#relations').onclick=()=>{currentView='tree';render();};
function editTreePerson(target){const node=target.closest('[data-tree-person]');if(!node)return;personId=node.dataset.treePerson;render();personEditor(true);}
$('#records').addEventListener('click',e=>{
 const zoom=e.target.closest('[data-tree-zoom]');
 if(zoom){const mode=zoom.dataset.treeZoom,svg=$('#records').querySelector('svg'),scale=treeScale==='fit'?Number(svg.getAttribute('width'))/Number(svg.getAttribute('viewBox').split(' ')[2]):treeScale;treeScale=mode==='fit'?'fit':Math.max(.15,Math.min(2.5,scale*(mode==='in'?1.3:1/1.3)));renderTree();return;}
 editTreePerson(e.target);
});
$('#records').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-tree-person]')){e.preventDefault();editTreePerson(e.target);}});
// 책으로 모아보기: 화면에 바로 책 모양으로 보여 주고, 인쇄·PDF 저장은 따로 버튼으로 엽니다.
// (예전에는 인쇄 창만 열었기 때문에 인쇄가 막힌 PC에서는 아무것도 보이지 않았습니다.)
function bookMarkup(forPrint){const img=p=>forPrint?imageMarkup(p).replace(' loading="lazy"',''):imageMarkup(p);return '<h1>우리 가족의 시간</h1><p>가족의 삶과 기억을 모은 기록집</p>'+data.people.map(p=>`<section class="chapter"><h1>${esc(p.name)}</h1><p>${esc(p.birth||'')}</p><div class="story">${esc(p.bio||'')}</div>${sorted(p.id).map(e=>`<article><h2>${esc(e.date)} · ${esc(e.title)}</h2><p>${esc(e.place)}</p><div class="story">${esc(e.body)}</div>${(e.photos||[]).map(img).join('')}<p>${esc(e.source||'')}</p></article>`).join('')}</section>`).join('');}
function renderBook(){$('#personMeta').textContent='책으로 모아보기';$('#title').textContent='우리 가족의 시간';if(!data.people.length){$('#records').innerHTML='<div class="empty">아직 책에 담을 가족이 없어요.<br>왼쪽 ＋ 가족 버튼으로 먼저 가족을 등록해 주세요.</div>';return;}$('#records').innerHTML=`<div class="book-toolbar"><button id="printBook" type="button" class="primary">인쇄 · PDF로 저장</button><span class="hint">인쇄 창에서 대상(프린터)을 "PDF로 저장"으로 고르면 파일로 받을 수 있어요.</span></div><div class="book-view">${bookMarkup(false)}</div>`;}
function printBook(){$('#printArea').innerHTML=bookMarkup(true);try{window.print();}catch{}$('#printArea').replaceChildren();}
$('#book').onclick=()=>{currentView='book';render();};
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
