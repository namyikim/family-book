const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
// 책으로 모아보기는 인쇄 창이 막힌 PC에서도 화면에 보여야 합니다.
test('book button shows the book on screen instead of only opening the print dialog',()=>{const a=fs.readFileSync('app.js','utf8');const handler=a.match(/\$\('#book'\)\.onclick=[^\n]*/)[0];assert(!handler.includes('print('));assert(handler.includes("currentView='book'"));assert(a.includes("else if(currentView==='book')renderBook()"));assert(/function printBook\(\)\{[^\n]*window\.print\(\)/.test(a));});
