'use strict';
// Only this browser profile can use this non-exportable device key.
const DeviceLogin=(()=>{
 const flag='family-book:remember-login',dbName='family-book-device-login';
 function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('session');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function access(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('session',mode),r=action(tx.objectStore('session'));tx.oncomplete=()=>{db.close();resolve(r?.result);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||Error('기기 저장소에 접근할 수 없습니다.'));};});}
 async function remember(session){
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const credentials={owner:session.owner,repo:session.repo,token:session.token,password:session.password};
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(credentials)));
  await access('readwrite',s=>s.put({key,iv,ciphertext},'current'));
  localStorage.setItem(flag,'1');
 }
 async function restore(){
  if(localStorage.getItem(flag)!=='1')return null;
  const entry=await access('readonly',s=>s.get('current'));if(!entry)return null;
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:entry.iv},entry.key,entry.ciphertext);
  const session=JSON.parse(new TextDecoder().decode(clear));
  if(!['owner','repo','token','password'].every(k=>typeof session[k]==='string'&&session[k]))throw Error('저장된 로그인 정보가 올바르지 않습니다.');
  return session;
 }
 async function forget(){localStorage.removeItem(flag);await access('readwrite',s=>s.clear());}
 return {remember,restore,forget};
})();
