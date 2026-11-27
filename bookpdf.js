// 책으로 만들기: 기록을 자서전 형식의 PDF 책으로 엮습니다.
// - 인쇄 창을 쓰지 않고 브라우저 안에서 PDF 파일을 직접 만들어 내려받습니다(인쇄가 막힌 PC에서도 동작).
// - 구성: 전체 가계도 → 표지 → 차례 → 사람마다 [이야기 첫 장(이름·소개) → 생애 단계별 글과 사진 → 연보] → 판권.
// - 판형은 신국판(152×225mm). 본문은 나눔명조, 작은 글씨와 한자는 나눔고딕. 글꼴은 쓰인 글자만 PDF에 넣습니다.
// - 기록과 사진은 이미 브라우저에서 복호화된 것만 쓰며, 어디에도 보내지 않습니다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyBookPdf = api;
}(globalThis, () => {
  'use strict';
  const MM = 72 / 25.4;
  const PAGE = { w: 152 * MM, h: 225 * MM, top: 24 * MM, bottom: 24 * MM, inner: 22 * MM, outer: 19 * MM };
  const BODY = { size: 10.2, lead: 18.2, indent: 10.2 };
  const INK = [0.13, 0.12, 0.11], GRAY = [0.45, 0.43, 0.4], ACCENT = [0.55, 0.36, 0.2], RULE = [0.78, 0.74, 0.68];
  const STAGES = ['출생', '유년기', '학창 시절', '청년기', '결혼과 가족', '직장과 활동', '중년 이후', '기타'];
  const ORDINALS = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두', '열세', '열네', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스무'];

  function fmtDate(d) {
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(d || '').trim());
    if (!m) return String(d || '').trim();
    return m[1] + '년' + (m[2] ? ' ' + Number(m[2]) + '월' : '') + (m[3] ? ' ' + Number(m[3]) + '일' : '');
  }
  const clean = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\t\u00a0\u2000-\u200a\u202f\u3000]/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u200b-\u200f\ufeff]/g, '');
  function sortedEvents(data, pid) {
    return data.events.filter(e => e.personId === pid).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
  }
  // 생애 단계 순서대로 묶고, 단계 안에서는 시기 순으로 둡니다.
  function groupByStage(events) {
    const order = s => { const i = STAGES.indexOf(s); return i < 0 ? STAGES.length : i; };
    const groups = [];
    for (const e of [...events].sort((a, b) => order(a.stage) - order(b.stage))) {
      const name = STAGES.includes(e.stage) ? e.stage : '기타';
      const last = groups[groups.length - 1];
      if (last && last.stage === name) last.events.push(e); else groups.push({ stage: name, events: [e] });
    }
    return groups;
  }

  // ───── 글자 재기와 줄 나누기 ─────
  // fonts: { R, B, G } 각각 { width(ch) → 1pt 기준 너비, has(codePoint) }
  function makeText(fonts) {
    const pick = (key, ch) => {
      const cp = ch.codePointAt(0);
      if (fonts[key].has(cp)) return key;
      if (fonts.G.has(cp)) return 'G';
      return null;
    };
    // 글자를 글꼴별 조각으로 나눕니다. 어느 글꼴에도 없는 글자는 빼 둡니다.
    function runs(str, key) {
      const out = [];
      for (const ch of str) {
        const k = pick(key, ch);
        if (!k) continue;
        const last = out[out.length - 1];
        if (last && last.font === k) last.s += ch; else out.push({ font: k, s: ch });
      }
      return out;
    }
    const runWidth = (r, size) => { let w = 0; for (const ch of r.s) w += fonts[r.font].width(ch); return w * size; };
    const width = (str, key, size) => runs(str, key).reduce((w, r) => w + runWidth(r, size), 0);
    // 한 문단을 줄로 나눕니다. 우리말 책처럼 글자 단위로 줄을 바꾸되,
    // 영문·숫자는 쪼개지 않고, 닫는 문장부호가 줄 첫머리에, 여는 문장부호가 줄 끝에 오지 않게 합니다.
    const CLOSE = /[)\]}〉》」』】,.!?:;…·~%’”、。]/, OPEN = /[(\[{〈《「『【‘“]/, LATIN = /[A-Za-z0-9@#$&_\/\-+=.,:']/;
    function units(str, key, size) {
      const out = [];
      for (const word of str.split(/ +/).filter(Boolean)) {
        let first = true, prev = '';
        for (const ch of word) {
          const glue = prev && (CLOSE.test(ch) || OPEN.test(prev) || (LATIN.test(prev) && LATIN.test(ch)));
          if (glue) out[out.length - 1].s += ch; else out.push({ s: ch, sp: first && out.length > 0 });
          first = false; prev = ch;
        }
      }
      for (const u of out) u.w = width(u.s, key, size);
      return out;
    }
    function wrap(str, key, size, maxW, firstIndent = 0) {
      const space = fonts[key].width(' ') * size;
      const lines = [];
      let line = { units: [], w: 0, indent: firstIndent, space };
      // 줄보다 긴 덩어리(긴 주소 등)는 글자 단위로 쪼갭니다.
      const list = units(str, key, size).flatMap(u => (u.w <= maxW - firstIndent ? [u] : [...u.s].map((ch, i) => ({ s: ch, sp: !i && u.sp, w: width(ch, key, size) }))));
      for (const u of list) {
        const lead = line.units.length && u.sp ? space : 0;
        if (line.units.length && line.w + lead + u.w > maxW - line.indent) { lines.push(line); line = { units: [], w: 0, indent: 0, space }; }
        line.w += (line.units.length && u.sp ? space : 0) + u.w;
        line.units.push(u);
      }
      if (line.units.length) lines.push(line);
      return lines;
    }
    const lineText = l => l.units.map((u, i) => (i && u.sp ? ' ' : '') + u.s).join('');
    return { runs, runWidth, width, wrap, lineText };
  }

  // ───── 쪽 배치 ─────
  // images: Map(photo → { key, width, height }) — 미리 불러 둔 사진의 크기
  function layout(data, opts, fonts, images) {
    const T = makeText(fonts);
    const title = clean(opts.title || '우리 가족의 시간'), subtitle = clean(opts.subtitle || '가족의 삶과 기억을 모은 기록집');
    const pages = [];
    const contentW = PAGE.w - PAGE.inner - PAGE.outer, contentH = PAGE.h - PAGE.top - PAGE.bottom;
    let page = null, y = 0, running = '';
    // 홀수 쪽(오른쪽)은 안쪽 여백이 왼쪽, 짝수 쪽(왼쪽)은 안쪽 여백이 오른쪽에 옵니다.
    const left = () => (pages.length % 2 === 1 ? PAGE.inner : PAGE.outer);
    function newPage(kind = 'body') { page = { ops: [], kind, running }; pages.push(page); y = PAGE.h - PAGE.top; return page; }
    const room = () => y - PAGE.bottom;
    const need = h => { if (room() < h) newPage(); };
    const text = (s, x, yy, key, size, color = INK) => { for (const r of T.runs(s, key)) { page.ops.push({ t: 'text', s: r.s, x, y: yy, font: r.font, size, color }); x += T.runWidth(r, size); } return x; };
    const centered = (s, yy, key, size, color = INK, cx = PAGE.w / 2) => text(s, cx - T.width(s, key, size) / 2, yy, key, size, color);
    const rule = (x1, x2, yy, color = RULE, thickness = 0.6) => page.ops.push({ t: 'line', x1, x2, y: yy, color, thickness });
    // 한 줄을 그립니다. justifyTo가 있으면 띄어쓰기와 글자 사이를 조금씩 벌려 양쪽을 맞춥니다.
    function drawLine(l, x, yy, key, size, color, justifyTo) {
      let a = 0, b = 0;
      const gaps = l.units.length - 1, spaces = l.units.filter((u, i) => i && u.sp).length;
      if (justifyTo && gaps > 0) {
        const extra = justifyTo - l.indent - l.w;
        if (extra > 0) {
          a = spaces ? Math.min(extra / spaces, size * 0.45) : 0;
          b = (extra - a * spaces) / gaps;
          if (b > size * 0.3) { a = 0; b = 0; }
        }
      }
      let cx = x + l.indent, buf = '', bx = cx;
      const flush = () => { if (buf) text(buf, bx, yy, key, size, color); buf = ''; };
      l.units.forEach((u, i) => {
        if (i) {
          const step = (u.sp ? l.space + a : 0) + b;
          if (step > 0.01) { flush(); cx += step; bx = cx; }
        }
        buf += u.s; cx += u.w;
      });
      flush();
    }
    // 문단들을 흘려 넣습니다. 쪽이 넘치면 다음 쪽으로 이어집니다.
    function paragraphs(str, o = {}) {
      const key = o.font || 'R', size = o.size || BODY.size, lead = o.lead || BODY.lead, color = o.color || INK;
      const indent = o.indent == null ? BODY.indent : o.indent, x0 = o.x == null ? null : o.x, w = o.width || contentW;
      const paras = clean(str).split('\n').map(s => s.trim());
      let blank = false, count = 0;
      for (const p of paras) {
        if (!p) { blank = true; continue; }
        if (blank && count) y -= lead * 0.5;
        blank = false; count++;
        const lines = T.wrap(p, key, size, w, indent);
        lines.forEach((l, i) => {
          need(lead);
          y -= lead;
          drawLine(l, x0 == null ? left() : x0 + left(), y + (lead - size) * 0.45, key, size, color, o.justify !== false && i < lines.length - 1 ? w : 0);
        });
        if (o.afterEach) o.afterEach(count);
      }
      return count;
    }
    // 사진 한 줄(한 장 또는 두 장 나란히)과 설명.
    function photoRow(row) {
      const gap = 10, capSize = 8, capLead = 12;
      const maxH = contentH * (row.length > 1 ? 0.42 : 0.5);
      const cells = row.map(p => {
        const im = images.get(p), ratio = im.width / im.height;
        let w = row.length > 1 ? (contentW - gap) / 2 : (ratio > 1.15 ? contentW : contentW * 0.66);
        let h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        return { im, w, h, cap: clean(p.caption || '').replace(/\n/g, ' ').trim() };
      });
      const capLines = c => (c.cap ? T.wrap(c.cap, 'G', capSize, row.length > 1 ? (contentW - gap) / 2 : contentW) : []);
      let h = Math.max(...cells.map(c => c.h));
      const capH = Math.max(...cells.map(c => capLines(c).length)) * capLead;
      let total = 10 + h + (capH ? 5 + capH : 0) + 12;
      if (room() < total) {
        // 조금만 모자라면 사진을 줄여 같은 쪽에 넣고, 많이 모자라면 다음 쪽으로 넘깁니다.
        const scale = (room() - (total - h)) / h;
        if (scale >= 0.72) { for (const c of cells) { c.w *= scale; c.h *= scale; } h *= scale; total = 10 + h + (capH ? 5 + capH : 0) + 12; }
        else newPage();
      }
      y -= 10;
      const totalW = cells.reduce((s, c) => s + c.w, 0) + gap * (cells.length - 1);
      let x = left() + (contentW - totalW) / 2;
      for (const c of cells) {
        const top = y - (h - c.h) / 2;
        page.ops.push({ t: 'img', key: c.im.key, x, y: top - c.h, w: c.w, h: c.h });
        capLines(c).forEach((l, i) => { const lw = l.w; drawLine(l, x + c.w / 2 - lw / 2, y - h - 5 - capLead * (i + 1) + 3, 'G', capSize, GRAY, 0); });
        x += c.w + gap;
      }
      y -= h + (capH ? 5 + capH : 0) + 12;
    }
    function photoRows(list) {
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const a = images.get(list[i]), b = list[i + 1] && images.get(list[i + 1]);
        if (b && a.width / a.height <= 1.15 && b.width / b.height <= 1.15) { rows.push([list[i], list[i + 1]]); i++; } else rows.push([list[i]]);
      }
      return rows;
    }

    // 전체 관계를 먼저 읽는 펼침면. 본문과 같은 배치를 재사용하고 벡터로 보존합니다.
    if (opts.tree && data.people.length) {
      const tree = opts.tree, scale = 0.65, margin = 32;
      const w = Math.max(PAGE.h, tree.width * scale + margin * 2);
      const h = Math.max(PAGE.w, tree.height * scale + 100);
      newPage('tree'); page.size = [w, h];
      text('우리 가족 전체 가계도', margin, h - 30, 'B', 19);
      text('실선: 부모·자녀    갈색 선: 배우자', margin, h - 49, 'G', 9, GRAY);
      const point = (x, y) => [margin + x * scale, h - 70 - y * scale];
      const line = (x1, y1, x2, y2, color = GRAY) => {
        const a = point(x1, y1), b = point(x2, y2);
        page.ops.push({ t: 'line', x1: a[0], y: a[1], x2: b[0], y2: b[1], thickness: 0.8, color });
      };
      const seen = new Set();
      for (const p of data.people) {
        const a = tree.positions.get(p.id);
        const b = tree.positions.get(p.spouse), key = [p.id, p.spouse].sort().join('|');
        if (b && p.id !== p.spouse && !seen.has(key)) {
          seen.add(key); const l = a.x < b.x ? a : b, r = a.x < b.x ? b : a;
          line(l.x + 180, l.y + 42, r.x, r.y + 42, ACCENT);
        }
        const parents = (tree.parentsOf.get(p.id) || []).map(id => tree.positions.get(id)).filter(Boolean);
        const bottom = Math.max(...parents.map(b => b.y + 84));
        if (parents.length && bottom < a.y) {
          const junction = parents.reduce((sum, b) => sum + b.x + 90, 0) / parents.length;
          const join = bottom + 18, bus = bottom + (a.y - bottom) / 2;
          for (const b of parents) { line(b.x + 90, b.y + 84, b.x + 90, join); line(b.x + 90, join, junction, join); }
          line(junction, join, junction, bus); line(junction, bus, a.x + 90, bus); line(a.x + 90, bus, a.x + 90, a.y);
        }
      }
      for (const p of data.people) {
        const a = tree.positions.get(p.id), xy = point(a.x, a.y + 84);
        page.ops.push({ t: 'rect', x: xy[0], y: xy[1], w: 180 * scale, h: 84 * scale, color: [1, 1, 1] });
        page.ops.push({ t: 'frame', x: xy[0], y: xy[1], w: 180 * scale, h: 84 * scale, color: RULE, thickness: 0.7 });
        const lines = T.wrap(clean(p.name), 'G', 10, 168 * scale);
        lines.forEach((l, i) => text(T.lineText(l), xy[0] + 5, xy[1] + 84 * scale - 14 - i * 12, 'G', 10));
        if (p.birth && lines.length < 3) text(clean(p.birth), xy[0] + 5, xy[1] + 9, 'G', 8, GRAY);
      }
      if (tree.warnings && tree.warnings.length) text('일부 관계는 확인이 필요합니다. 사이트 가계도의 안내를 확인해 주세요.', margin, 18, 'G', 8, GRAY);
    }

    // 1. 표지
    newPage('cover');
    page.ops.push({ t: 'rect', x: 0, y: 0, w: PAGE.w, h: PAGE.h, color: [0.96, 0.94, 0.9] });
    page.ops.push({ t: 'frame', x: 13 * MM, y: 13 * MM, w: PAGE.w - 26 * MM, h: PAGE.h - 26 * MM, color: ACCENT, thickness: 0.8 });
    page.ops.push({ t: 'frame', x: 14.5 * MM, y: 14.5 * MM, w: PAGE.w - 29 * MM, h: PAGE.h - 29 * MM, color: ACCENT, thickness: 0.3 });
    centered('FAMILY CHRONICLE', PAGE.h * 0.74, 'G', 8, ACCENT);
    const titleLines = T.wrap(title, 'B', 30, PAGE.w - 50 * MM);
    titleLines.forEach((l, i) => centered(T.lineText(l), PAGE.h * 0.66 - i * 40, 'B', 30));
    const afterTitle = PAGE.h * 0.66 - (titleLines.length - 1) * 40;
    rule(PAGE.w / 2 - 22, PAGE.w / 2 + 22, afterTitle - 22, ACCENT, 0.8);
    centered(subtitle, afterTitle - 46, 'R', 11.5, GRAY);
    const names = data.people.map(p => clean(p.name).trim()).filter(Boolean);
    T.wrap(names.join(' · '), 'R', 10.5, PAGE.w - 56 * MM).forEach((l, i) => centered(T.lineText(l), PAGE.h * 0.3 - i * 17, 'R', 10.5));
    if (opts.year) centered(String(opts.year), 24 * MM, 'G', 8.5, GRAY);
    newPage('blank');

    // 2. 차례(쪽수는 본문 배치가 끝난 뒤 채웁니다)
    const tocEntries = [];
    data.people.forEach((p, i) => {
      tocEntries.push({ level: 0, label: (ORDINALS[i] || (i + 1) + '번째') + (ORDINALS[i] ? ' 번째' : '') + ' 이야기', name: clean(p.name), ref: 'p' + i });
      const groups = groupByStage(sortedEvents(data, p.id));
      groups.forEach((g, j) => tocEntries.push({ level: 1, name: g.stage, ref: 'p' + i + 's' + j }));
      if (groups.length) tocEntries.push({ level: 1, name: '연보', ref: 'p' + i + 'c' });
    });
    const tocFirst = 13, tocLead = 19, tocTop = PAGE.h - PAGE.top - 70;
    const tocPerFirst = Math.floor((tocTop - PAGE.bottom) / tocLead), tocPerNext = Math.floor(contentH / tocLead);
    const tocPageCount = tocEntries.length <= tocPerFirst ? 1 : 1 + Math.ceil((tocEntries.length - tocPerFirst) / tocPerNext);
    const tocPages = [];
    for (let i = 0; i < tocPageCount; i++) tocPages.push(newPage('toc'));
    const marks = {};
    const mark = ref => { marks[ref] = pages.length; };

    // 3. 사람마다 한 편의 이야기
    data.people.forEach((p, i) => {
      const name = clean(p.name).trim(), events = sortedEvents(data, p.id), groups = groupByStage(events);
      running = '';
      if (pages.length % 2 === 1) newPage('blank'); // 이야기 첫 장은 오른쪽 쪽에서 시작
      newPage('opener'); mark('p' + i);
      y = PAGE.h - PAGE.top - contentH * 0.2;
      text((ORDINALS[i] ? ORDINALS[i] + ' 번째' : (i + 1) + '번째') + ' 이야기', left(), y, 'G', 9, ACCENT);
      y -= 40;
      text(name, left(), y, 'B', 27);
      y -= 16; rule(left(), left() + 34, y, ACCENT, 1);
      if (p.birth) { y -= 22; text(fmtDate(p.birth) + ' 출생', left(), y, 'G', 9, GRAY); }
      y -= 26;
      if (clean(p.bio).trim()) paragraphs(p.bio, { size: 10.8, lead: 20 });
      running = name;
      groups.forEach((g, j) => {
        // 생애 단계는 새 쪽에서 시작하되, 앞 쪽이 절반 넘게 비어 있으면 이어서 씁니다.
        if (!j || room() < contentH * 0.5) newPage(); else y -= 30;
        mark('p' + i + 's' + j);
        y -= 18;
        text(String(j + 1).padStart(2, '0'), left(), y, 'G', 9, ACCENT);
        y -= 26; text(g.stage, left(), y, 'B', 19);
        y -= 13; rule(left(), left() + contentW, y);
        y -= 20;
        g.events.forEach((e, k) => {
          const shots = (e.photos || []).filter(ph => images.has(ph)), rows = photoRows(shots);
          const body = clean(e.body).trim();
          if (k) y -= 22;
          const tLines = T.wrap(clean(e.title).replace(/\n/g, ' '), 'B', 13, contentW);
          need(tLines.length * 20 + 16 + BODY.lead * 3); // 제목만 쪽 끝에 남지 않게
          tLines.forEach(l => { y -= 20; drawLine(l, left(), y + 4, 'B', 13, INK, 0); });
          const meta = [fmtDate(e.date), clean(e.place).trim()].filter(Boolean).join('  ·  ');
          if (meta) { y -= 15; text(meta, left(), y + 3, 'G', 8.3, GRAY); }
          y -= 8;
          let placed = 0;
          if (body) {
            // 첫 문단 뒤에 첫 사진을 넣어 글과 사진이 어우러지게 합니다.
            const many = body.split('\n').filter(s => s.trim()).length > 1;
            paragraphs(body, { afterEach: n => { if (many && n === 1 && rows.length) { photoRow(rows[0]); placed = 1; } } });
          }
          rows.slice(placed).forEach(photoRow);
          const src = clean(e.source).trim();
          if (src) { y -= 4; paragraphs('자료: ' + src, { font: 'G', size: 7.8, lead: 12.5, color: GRAY, indent: 0, justify: false }); }
        });
      });
      if (events.length) {
        newPage(); mark('p' + i + 'c');
        y -= 18; text('연보', left(), y - 26, 'B', 19); y -= 39; rule(left(), left() + contentW, y); y -= 16;
        const dateW = 78;
        for (const e of events) {
          const lines = T.wrap(clean(e.title).replace(/\n/g, ' '), 'R', 9.6, contentW - dateW);
          need(lines.length * 16 + 5);
          lines.forEach((l, n) => { y -= 16; if (!n) text(fmtDate(e.date), left(), y + 4, 'G', 8.3, ACCENT); drawLine(l, left() + dateW, y + 4, 'R', 9.6, INK, 0); });
          y -= 5;
        }
      }
    });

    // 4. 판권
    running = '';
    newPage('colophon');
    y = PAGE.bottom + 74;
    rule(left(), left() + contentW, y + 18);
    text(title, left(), y, 'B', 11);
    [subtitle, opts.madeOn ? '엮은 날  ' + fmtDate(opts.madeOn) : '', '이 책은 가족이 함께 남긴 기록을 모아 만들었습니다.'].filter(Boolean).forEach((s, n) => text(s, left(), y - 18 - n * 14, 'G', 8.3, GRAY));

    // 차례 채우기
    let ti = 0;
    tocPages.forEach((tp, n) => {
      page = tp; const base = pages.indexOf(tp) + 1, x0 = base % 2 === 1 ? PAGE.inner : PAGE.outer;
      let ty = PAGE.h - PAGE.top;
      if (!n) { text('차례', x0, ty - 34, 'B', 19); rule(x0, x0 + contentW, ty - 48); ty = tocTop; }
      const limit = n ? tocPerNext : tocPerFirst;
      for (let c = 0; c < limit && ti < tocEntries.length; c++, ti++) {
        const en = tocEntries[ti], num = String(marks[en.ref] || '');
        ty -= tocLead;
        let x = x0;
        if (en.level === 0) { x = text(en.label, x0, ty + 5, 'G', 7.8, ACCENT) + 8; x = text(en.name, x, ty + 5, 'B', tocFirst - 2); }
        else x = text(en.name, x0 + 16, ty + 5, 'R', 9.6, GRAY);
        const nw = T.width(num, 'G', 8.5);
        text(num, x0 + contentW - nw, ty + 5, 'G', 8.5, en.level ? GRAY : INK);
        if (x0 + contentW - nw - 8 > x + 8) page.ops.push({ t: 'dots', x1: x + 8, x2: x0 + contentW - nw - 8, y: ty + 7, color: RULE });
      }
    });

    // 쪽번호와 머리글(본문 쪽만)
    pages.forEach((pg, n) => {
      const num = n + 1; page = pg;
      if (pg.kind !== 'body') return;
      const odd = num % 2 === 1, x0 = odd ? PAGE.inner : PAGE.outer, s = String(num), fy = PAGE.bottom - 30, hy = PAGE.h - PAGE.top + 16;
      const before = pages.length;
      text(s, odd ? x0 + contentW - T.width(s, 'G', 8.5) : x0, fy, 'G', 8.5, GRAY);
      const head = odd ? pg.running : title;
      if (head) text(head, odd ? x0 + contentW - T.width(head, 'G', 7.5) : x0, hy, 'G', 7.5, GRAY);
      if (pages.length !== before) throw new Error('쪽 배치 오류');
    });
    return { pages, marks, size: [PAGE.w, PAGE.h] };
  }

  // ───── PDF 만들기 ─────
  // o: { data, title, subtitle, year, madeOn, PDFLib, fontkit, fontBytes: {R,B,G}, loadPhoto(photo) → {bytes,type,width,height}|null, onProgress }
  async function build(o) {
    const { PDFDocument, rgb } = o.PDFLib, progress = o.onProgress || (() => {});
    const doc = await PDFDocument.create();
    doc.registerFontkit(o.fontkit);
    doc.setTitle(o.title || '우리 가족의 시간'); doc.setCreator('가족의 시간'); doc.setProducer('가족의 시간');
    const pdfFonts = {}, fonts = {};
    for (const k of ['R', 'B', 'G']) {
      const f = pdfFonts[k] = await doc.embedFont(o.fontBytes[k], { subset: true });
      const set = new Set(f.getCharacterSet()), cache = new Map();
      fonts[k] = { has: cp => set.has(cp), width: ch => { let w = cache.get(ch); if (w == null) { w = f.widthOfTextAtSize(ch, 100) / 100; cache.set(ch, w); } return w; } };
    }
    // 사진을 먼저 모두 불러 크기를 알아 둡니다. 못 불러온 사진은 빼고 계속합니다.
    const images = new Map(), embedded = new Map(), all = [];
    for (const p of o.data.people) for (const e of sortedEvents(o.data, p.id)) for (const ph of e.photos || []) all.push(ph);
    let done = 0, failed = 0;
    for (const ph of all) {
      progress('사진을 책에 넣는 중… (' + (++done) + '/' + all.length + ')');
      try {
        const im = o.loadPhoto ? await o.loadPhoto(ph) : null;
        if (!im) { failed++; continue; }
        const key = 'i' + images.size;
        embedded.set(key, im.type === 'image/png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes));
        const e = embedded.get(key);
        images.set(ph, { key, width: im.width || e.width, height: im.height || e.height });
      } catch { failed++; }
    }
    progress('쪽을 짜는 중…');
    const book = layout(o.data, o, fonts, images);
    for (const pg of book.pages) {
      const page = doc.addPage(pg.size || book.size);
      for (const op of pg.ops) {
        const color = op.color ? rgb(...op.color) : undefined;
        if (op.t === 'text') page.drawText(op.s, { x: op.x, y: op.y, size: op.size, font: pdfFonts[op.font], color });
        else if (op.t === 'img') page.drawImage(embedded.get(op.key), { x: op.x, y: op.y, width: op.w, height: op.h });
        else if (op.t === 'line') page.drawLine({ start: { x: op.x1, y: op.y }, end: { x: op.x2, y: op.y2 ?? op.y }, thickness: op.thickness, color });
        else if (op.t === 'dots') page.drawLine({ start: { x: op.x1, y: op.y }, end: { x: op.x2, y: op.y }, thickness: 0.6, color, dashArray: [0.6, 3], lineCap: 1 });
        else if (op.t === 'rect') page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color });
        else if (op.t === 'frame') page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, borderColor: color, borderWidth: op.thickness });
      }
    }
    progress('PDF 파일로 묶는 중…');
    return { bytes: await doc.save(), pages: book.pages.length, photos: images.size, failedPhotos: failed };
  }

  // ───── 브라우저에서 쓰기 ─────
  const FONT_FILES = { R: 'fonts/NanumMyeongjo-Regular.ttf', B: 'fonts/NanumMyeongjo-Bold.ttf', G: 'fonts/NanumGothic-Regular.ttf' };
  let assets = null;
  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('책을 만드는 데 필요한 파일을 불러오지 못했습니다: ' + src)); document.head.append(s); });
  }
  // PDF 도구와 글꼴은 크기가 커서 책을 만들 때 처음 한 번만 불러옵니다.
  function loadAssets(progress) {
    if (!assets) assets = (async () => {
      progress('책 만들기 도구와 글꼴을 불러오는 중… (처음 한 번은 조금 걸립니다)');
      if (!globalThis.PDFLib) await loadScript('lib/pdf-lib.min.js');
      if (!globalThis.fontkit) await loadScript('lib/fontkit.umd.min.js');
      const fontBytes = {};
      await Promise.all(Object.entries(FONT_FILES).map(async ([k, url]) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error('글꼴 파일을 불러오지 못했습니다: ' + url);
        fontBytes[k] = new Uint8Array(await r.arrayBuffer());
      }));
      return { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit, fontBytes };
    })().catch(e => { assets = null; throw e; });
    return assets;
  }
  // 사진 주소(blob: 또는 data:)를 PDF에 넣을 수 있는 JPEG로 바꿉니다(WebP도 처리).
  async function photoFromUrl(url) {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('사진을 열지 못했습니다.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0);
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.9));
    if (!blob) throw new Error('사진을 바꾸지 못했습니다.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', width: canvas.width, height: canvas.height };
  }
  async function download(o) {
    const progress = o.onProgress || (() => {});
    const a = await loadAssets(progress);
    const today = new Date(), day = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const result = await build({ ...a, data: o.data, tree: o.tree, title: o.title, subtitle: o.subtitle, year: today.getFullYear(), madeOn: day, loadPhoto: o.loadPhoto, onProgress: progress });
    const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' })), link = document.createElement('a');
    link.href = url; link.download = (o.fileName || 'family-book') + '_' + day + '.pdf'; // 한글 파일 이름은 일부 브라우저에서 깨져 영문으로 둡니다.
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return result;
  }
  return { PAGE, STAGES, fmtDate, groupByStage, sortedEvents, makeText, layout, build, download, photoFromUrl };
}));
