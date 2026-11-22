const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('remembered login restores encrypted credentials and logout removes them',async()=>{
 const stored=new Map(),flags=new Map();
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={};tx.objectStore=()=>{const run=fn=>{const r={};queueMicrotask(()=>{r.result=fn();tx.oncomplete();});return r;};return {put:(v,k)=>run(()=>stored.set(k,structuredClone(v))),get:k=>run(()=>stored.get(k)),clear:()=>run(()=>stored.clear())};};return tx;}};request.onsuccess();});return request;}};
 const ctx={crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,indexedDB,localStorage:{getItem:k=>flags.get(k),setItem:(k,v)=>flags.set(k,v),removeItem:k=>flags.delete(k)}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('device-login.js','utf8')+';globalThis.login=DeviceLogin',ctx);
 assert.equal(await ctx.login.restore(),null);
 const session={owner:'test',repo:'private',token:'synthetic-token',password:'synthetic-password'};await ctx.login.remember(session);
 const entry=stored.get('current');assert.equal(entry.key.extractable,false);assert(!new TextDecoder().decode(entry.ciphertext).includes(session.token));
 assert.equal(JSON.stringify(await ctx.login.restore()),JSON.stringify(session));
 await ctx.login.forget();assert.equal(stored.size,0);assert.equal(await ctx.login.restore(),null);
});
