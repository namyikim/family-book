const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const B = require('../bookpdf.js');

// 글꼴 없이 배치만 시험할 때 쓰는 가짜 글꼴(모든 글자 너비 1, 띄어쓰기 0.3)
const fake = { has: () => true, width: ch => (ch === ' ' ? 0.3 : 1) };
const fonts = { R: fake, B: fake, G: fake };
const sample = {
  version: 1,
  people: [{ id: 'a', name: '홍길동', birth: '1940-03-02', bio: '소개 글입니다.' }, { id: 'b', name: '김영희' }],
  events: [
    { id: '1', personId: 'a', date: '1960', stage: '청년기', title: '입대', place: '논산', body: '첫 문단.\n둘째 문단.', source: '구술', photos: [] },
    { id: '2', personId: 'a', date: '1940-03-02', stage: '출생', title: '태어나다', place: '', body: '가'.repeat(3000), photos: [] },
  ],
};

test('dates read like a book', () => {
  assert.equal(B.fmtDate('1990'), '1990년');
  assert.equal(B.fmtDate('1990-03'), '1990년 3월');
  assert.equal(B.fmtDate('1990-03-21'), '1990년 3월 21일');
});

test('events are grouped by life stage in life order', () => {
  assert.deepEqual(B.groupByStage(B.sortedEvents(sample, 'a')).map(g => g.stage), ['출생', '청년기']);
});

test('lines break between Korean letters but keep punctuation and Latin words together', () => {
  const T = B.makeText(fonts);
  const lines = T.wrap('가나다라마바사, (아자차) English 카타파하', 'R', 10, 82);
  for (const l of lines) {
    assert(l.w <= 82 + 1e-9);
    assert(!/^[,.)]/.test(T.lineText(l)), 'no closing punctuation at line start');
    assert(!/\($/.test(T.lineText(l)), 'no opening bracket at line end');
  }
  assert.equal(lines.map(T.lineText).join(' ').replace(/ /g, ''), '가나다라마바사,(아자차)English카타파하');
  assert(lines.some(l => T.lineText(l).includes('English')));
});

test('layout makes cover, contents, a chapter per person with page numbers', () => {
  const book = B.layout(sample, { title: '우리 가족의 시간' }, fonts, new Map());
  const kinds = book.pages.map(p => p.kind);
  assert.equal(kinds[0], 'cover');
  assert.equal(kinds[2], 'toc');
  assert.equal(kinds.filter(k => k === 'opener').length, 2);
  assert.equal(kinds[kinds.length - 1], 'colophon');
  assert.equal(book.marks.p0 % 2, 1, 'chapters open on a right-hand page');
  assert(book.marks.p0s1 > book.marks.p0s0, 'long text flows on to later pages');
  const tocText = book.pages[2].ops.filter(o => o.t === 'text').map(o => o.s).join('|');
  assert(tocText.includes('홍길동') && tocText.includes(String(book.marks.p0)));
  for (const pg of book.pages) for (const o of pg.ops) if (o.t === 'text') assert(o.y > 0 && o.y < book.size[1] && o.x >= 0 && o.x < book.size[0]);
});

test('a real PDF is produced with Korean and Hanja fonts embedded', async () => {
  const PDFLib = require('../lib/pdf-lib.min.js'), fontkit = require('../lib/fontkit.umd.min.js');
  const fontBytes = { R: fs.readFileSync('fonts/NanumMyeongjo-Regular.ttf'), B: fs.readFileSync('fonts/NanumMyeongjo-Bold.ttf'), G: fs.readFileSync('fonts/NanumGothic-Regular.ttf') };
  const data = structuredClone(sample);
  data.events[0].body += '\n漢字도 들어갑니다.';
  const r = await B.build({ PDFLib, fontkit, fontBytes, data, tree: {width: 400, height: 300, positions: new Map([['a', {x: 20, y: 20}], ['b', {x: 220, y: 20}]]), parentsOf: new Map()}, title: '우리 가족의 시간', year: 2026, madeOn: '2026-11-25' });
  assert.equal(Buffer.from(r.bytes.slice(0, 5)).toString(), '%PDF-');
  assert(r.pages >= 8);
  const doc = await PDFLib.PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(), r.pages);
  assert(doc.getPage(0).getWidth() > doc.getPage(1).getWidth());
  assert(r.bytes.length < 2_000_000, 'fonts are subset, not embedded whole');
});

test('the site loads the book maker and keeps the strict content policy', () => {
  const html = fs.readFileSync('index.html', 'utf8'), app = fs.readFileSync('app.js', 'utf8');
  assert(html.includes('bookpdf.js'));
  assert(html.includes("script-src 'self'"));
  assert(app.includes('id="makePdf"') && app.includes('FamilyBookPdf.download'));
});

 test('whole family tree is the first PDF page, with readable vector labels and correct contents', () => {
  const tree = { width: 1200, height: 400, positions: new Map([['a', {x: 30, y: 30}], ['b', {x: 30, y: 240}]]), parentsOf: new Map([['b', ['a']]]) };
  const book = B.layout(sample, { tree }, fonts, new Map());
  assert.equal(book.pages[0].kind, 'tree');
  assert.equal(book.pages[1].kind, 'cover');
  const pg = book.pages[0];
  assert(pg.size[0] > B.PAGE.w);
  for (const p of sample.people) assert(pg.ops.some(op => op.t === 'text' && op.s === p.name && op.size >= 10));
  assert(pg.ops.some(op => op.t === 'line' && op.y2 !== op.y));
  for (const op of pg.ops) {
    if (op.t === 'text') assert(op.x >= 0 && op.y > 0 && op.y < pg.size[1]);
    if (op.t === 'frame') assert(op.x + op.w <= pg.size[0] && op.y + op.h <= pg.size[1]);
  }
  assert.equal(book.marks.p0 % 2, 1);
  const toc = book.pages.find(p => p.kind === 'toc');
  assert(toc.ops.some(op => op.t === 'text' && op.s === String(book.marks.p0)));
});
