const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8').replace('restoreDeviceLogin();','');
function setup(){const els={};const el=()=>({value:'',textContent:'',hidden:false,open:true,files:[],dataset:{},classList:{toggle(){}},querySelector(){return el()},addEventListener(){},close(){this.open=false},replaceChildren(){}});const ctx={DeviceLogin:{restore:async()=>null},console,structuredClone,TextEncoder,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},document:{querySelector:s=>els[s]??=el(),querySelectorAll:()=>[]},window:{addEventListener(){}},FormData:class{constructor(f){this.f=f}*[Symbol.iterator](){for(const [k,v] of Object.entries(this.f.elements))yield [k,v.value]}},confirm:()=>true};vm.createContext(ctx);vm.runInContext(source,ctx);vm.runInContext("render=()=>{};showPhotos=()=>{};personId='person';save=async()=>true;",ctx);return {ctx,els};}
function form(){const f={elements:{},querySelector:()=>({textContent:'',disabled:false}),closest:()=>({open:true,close(){}})};for(const [k,v] of Object.entries({id:'',date:'2000',title:'첫 기록',body:'내용',place:'',source:'',stage:'출생',photos:''}))f.elements[k]={value:v,files:[]};return f;}
test('autosave updates same event and preserves newer typing while saving',async()=>{const {ctx,els}=setup();const f=form();await els['#eventForm'].onsubmit({preventDefault(){},target:f,auto:true});const id=f.elements.id.value;assert(id);f.elements.body.value='수정 내용';await els['#eventForm'].onsubmit({preventDefault(){},target:f,auto:true});assert.equal(vm.runInContext('data.events.length',ctx),1);assert.equal(vm.runInContext('data.events[0].body',ctx),'수정 내용');let finish;ctx.pending=new Promise(r=>finish=r);vm.runInContext('save=()=>pending;formPending=true',ctx);const saving=els['#eventForm'].onsubmit({preventDefault(){},target:f,auto:true});vm.runInContext('formRevision++',ctx);f.elements.body.value='추가 입력';finish(true);await saving;assert.equal(vm.runInContext('formPending',ctx),true);});
test('failed server save leaves form pending',async()=>{const {ctx,els}=setup();vm.runInContext('save=async()=>false;formPending=true',ctx);await els['#eventForm'].onsubmit({preventDefault(){},target:form(),auto:true});assert.equal(vm.runInContext('formPending',ctx),true);});
test('child and spouse share row and remain adjacent',()=>{const {ctx,els}=setup();vm.runInContext(`data.people=[{id:'parent',name:'부모',parents:[]},{id:'child',name:'자녀',parents:['parent'],spouse:'partner'},{id:'other',name:'다른 가족',parents:[]},{id:'partner',name:'배우자',parents:[],spouse:'child'}];personId='child';renderTree()`,ctx);const html=els['#records'].innerHTML;const box=id=>{const m=html.match(new RegExp('data-tree-person="'+id+'"[^]*?<rect x="([0-9.]+)" y="([0-9.]+)"'));return [+m[1],+m[2]]};const child=box('child'),spouse=box('partner');assert.equal(child[1],spouse[1]);assert.equal(spouse[0]-child[0],210);assert(child[1]>box('parent')[1]);assert(html.includes('data-tree-person="other"'));});

test('manual save waits for server success before closing',async()=>{const {ctx,els}=setup();const f=form();let closed=0,finish;f.closest=()=>({open:true,close(){closed++}});ctx.pending=new Promise(r=>finish=r);vm.runInContext('save=()=>pending;formPending=true',ctx);const task=els['#eventForm'].onsubmit({preventDefault(){},target:f});assert.equal(closed,0);finish(true);await task;assert.equal(closed,1);});
test('manual save failure keeps editor open',async()=>{const {ctx,els}=setup();const f=form();let closed=0;f.closest=()=>({open:true,close(){closed++}});vm.runInContext('save=async()=>false;formPending=true',ctx);await els['#eventForm'].onsubmit({preventDefault(){},target:f});assert.equal(closed,0);assert.equal(vm.runInContext('formPending',ctx),true);});
test('manual save clicked during autosave closes when that save succeeds',async()=>{const {ctx,els}=setup();const f=form();let closed=0,finish;f.closest=()=>({open:true,close(){closed++}});ctx.pending=new Promise(r=>finish=r);vm.runInContext('save=()=>pending;formPending=true',ctx);const task=els['#eventForm'].onsubmit({preventDefault(){},target:f,auto:true});await els['#eventForm'].onsubmit({preventDefault(){},target:f});assert.equal(closed,0);finish(true);await task;assert.equal(closed,1);});

test('whole tree aligns spouses and siblings across unequal ancestry depth',()=>{
 const {ctx,els}=setup();
 vm.runInContext(`data.people=[
 {id:'ancestor',name:'Ancestor'},
 {id:'grandA',name:'Grand A',parents:['ancestor'],spouse:'grandB'},
 {id:'grandB',name:'Grand B',spouse:'grandA'},
 {id:'otherGrandA',name:'Other grand A',spouse:'otherGrandB'},
 {id:'otherGrandB',name:'Other grand B',spouse:'otherGrandA'},
 {id:'father',name:'Father',parents:['grandA','grandB'],spouse:'mother'},
 {id:'mother',name:'Mother',parents:['otherGrandA','otherGrandB'],spouse:'father'},
 {id:'uncle',name:'Uncle',parents:['otherGrandA','otherGrandB']},
 {id:'childA',name:'Child A',parents:['father','mother'],spouse:'partner'},
 {id:'partner',name:'Partner',spouse:'childA'},
 {id:'childB',name:'Child B',parents:['father','mother']},
 {id:'unlinked',name:'Unlinked'}
 ];personId='childA';renderTree();`,ctx);
 const result=vm.runInContext('familyTreeLayout(data.people)',ctx),pos=id=>result.positions.get(id);
 assert.equal(result.positions.size,12);assert.equal(result.warnings.length,0);
 for(const [a,b] of [['grandA','otherGrandA'],['father','mother'],['mother','uncle'],['childA','childB'],['childA','partner']])assert.equal(pos(a).y,pos(b).y);
 for(const [parent,child] of [['ancestor','grandA'],['grandA','father'],['otherGrandA','mother'],['father','childA']])assert.equal(pos(child).y-pos(parent).y,200);
 const html=els['#records'].innerHTML;
 assert(html.includes('Father · Mother → Child A, Child B'));
 assert(html.includes('관계 미연결'));
});
test('inconsistent generations are reported instead of looping or inventing relationships',()=>{
 const {ctx}=setup();
 const result=vm.runInContext(`familyTreeLayout([{id:'a',name:'A',parents:['b']},{id:'b',name:'B',parents:['a']}])`,ctx);
 assert(result.warnings.length>0);assert.equal(result.positions.size,2);
});
test('husband sits left of wife and 친가 stays left of 외가',()=>{
 const {ctx,els}=setup();
 // Data order deliberately lists the wife and the maternal side first.
 vm.runInContext(`data.people=[
 {id:'mgf',name:'외할아버지',gender:'M',spouse:'mgm'},
 {id:'mgm',name:'외할머니',gender:'F',spouse:'mgf'},
 {id:'mother',name:'어머니',gender:'F',parents:['mgf','mgm'],spouse:'father'},
 {id:'aunt',name:'이모',gender:'F',parents:['mgf','mgm']},
 {id:'pgm',name:'할머니',gender:'F',spouse:'pgf'},
 {id:'pgf',name:'할아버지',spouse:'pgm'},
 {id:'father',name:'아버지',gender:'M',parents:['pgf','pgm'],spouse:'mother'},
 {id:'uncle',name:'큰아버지',gender:'M',parents:['pgf','pgm']},
 {id:'me',name:'나',parents:['father','mother']}
 ];personId='me';renderTree();`,ctx);
 const r=vm.runInContext(`familyTreeLayout(data.people,'me')`,ctx),pos=id=>r.positions.get(id);
 for(const [left,right] of [['father','mother'],['pgf','pgm'],['mgf','mgm']])assert.equal(pos(right).x-pos(left).x,210);
 assert(pos('pgm').x<pos('mgf').x);assert(pos('uncle').x<pos('father').x);assert(pos('mother').x<pos('aunt').x);
 assert(r.sides.paternal.has('uncle')&&r.sides.maternal.has('aunt')&&!r.sides.paternal.has('me')&&!r.sides.maternal.has('me'));
 const html=els['#records'].innerHTML;assert(html.includes('친가 · 아버지 쪽'));assert(html.includes('외가 · 어머니 쪽'));
});
test('sibling linked without parents sits beside their sibling on the right family side',()=>{
 const {ctx,els}=setup();
 vm.runInContext(`data.people=[
 {id:'brother',name:'조용무',gender:'M',siblings:['sister']},
 {id:'pgf',name:'할아버지',gender:'M',spouse:'pgm'},{id:'pgm',name:'할머니',gender:'F',spouse:'pgf'},
 {id:'father',name:'아버지',gender:'M',parents:['pgf','pgm'],spouse:'sister'},
 {id:'uncle',name:'큰아버지',gender:'M',parents:['pgf','pgm']},
 {id:'sister',name:'조용옥',gender:'F',spouse:'father',siblings:['brother']},
 {id:'me',name:'나',parents:['father','sister']}
 ];personId='me';renderTree();`,ctx);
 const r=vm.runInContext(`familyTreeLayout(data.people,'me')`,ctx),pos=id=>r.positions.get(id);
 assert.equal(r.components.length,1);assert.equal(pos('brother').y,pos('sister').y);
 assert(pos('brother').x>pos('sister').x);assert(pos('uncle').x<pos('father').x);
 assert(r.sides.maternal.has('brother'));assert(r.sides.paternal.has('uncle'));
 assert(els['#records'].innerHTML.includes('조용옥 · 조용무 (형제자매)')||els['#records'].innerHTML.includes('조용무 · 조용옥 (형제자매)'));
});
test('sibling without parents inherits the registered parents of a sibling',()=>{
 const {ctx}=setup();
 const r=vm.runInContext(`familyTreeLayout([{id:'gf',name:'GF'},{id:'a',name:'A',parents:['gf']},{id:'b',name:'B',siblings:['a']}])`,ctx);
 assert.deepEqual([...r.parentsOf.get('b')],['gf']);assert.equal(r.positions.get('a').y,r.positions.get('b').y);
});
test('saving siblings links both people and unlinking removes both sides',()=>{
 const {ctx}=setup();
 let next=vm.runInContext(`updateFamilyRelations([{id:'a',name:'A'},{id:'b',name:'B'}],{id:'a',name:'A',parents:[],siblings:['b']},[])`,ctx);
 assert.deepEqual([...next.find(x=>x.id==='b').siblings],['a']);
 ctx.next=next;next=vm.runInContext(`updateFamilyRelations(next,{id:'a',name:'A',parents:[],siblings:[]},[])`,ctx);
 assert.equal(next.find(x=>x.id==='b').siblings,undefined);
});
