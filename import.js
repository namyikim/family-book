// 기록 가져오기: 사람과 기록 여러 건이 담긴 JSON 파일을 현재 기록에 합칩니다.
// 형식: { "version": 1, "people": [...], "events": [...] } (평문, 암호화하지 않은 파일)
// - 같은 id 또는 같은 이름(괄호·공백 무시)의 사람이 있으면 새로 만들지 않고 그 사람에게 붙입니다.
// - 이미 있는 기록(같은 id, 또는 같은 사람·시기·제목)은 건너뛰므로 같은 파일을 두 번 넣어도 중복되지 않습니다.
// - 기존 사람의 정보와 기존 기록은 바꾸지 않습니다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyImport = api;
}(globalThis, () => {
  'use strict';
  const STAGES = ['출생', '유년기', '학창 시절', '청년기', '결혼과 가족', '직장과 활동', '중년 이후', '기타'];
  const DATE = /^[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?$/;
  const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const MAX_FILE = 20 * 1024 * 1024;
  const norm = s => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s+/g, '');
  const text = (v, max, label) => {
    if (v == null) return '';
    if (typeof v !== 'string') throw Error(label + ' 항목은 글자여야 합니다.');
    if (v.length > max) throw Error(label + ' 항목이 너무 깁니다(최대 ' + max.toLocaleString('ko-KR') + '자).');
    return v;
  };
  const newId = () => globalThis.crypto.randomUUID();

  function parse(raw) {
    if (typeof raw === 'string' && raw.length > MAX_FILE) throw Error('가져오기 파일이 너무 큽니다(20MB 이하).');
    let d;
    try { d = typeof raw === 'string' ? JSON.parse(raw.replace(/^﻿/, '')) : raw; } catch { throw Error('JSON 파일을 읽지 못했습니다. 파일 내용을 확인해 주세요.'); }
    if (d && typeof d.ciphertext === 'string') throw Error('암호화 백업 파일은 가져올 수 없습니다. 가져오기용 평문 파일을 골라 주세요.');
    if (!d || d.version !== 1 || !Array.isArray(d.people) || !Array.isArray(d.events)) throw Error('가져오기 형식이 아닙니다. version 1, people, events가 필요합니다.');
    return d;
  }

  // current는 바꾸지 않고, 합친 결과와 요약을 돌려줍니다.
  function merge(current, raw) {
    const incoming = parse(raw);
    const data = structuredClone(current);
    const map = new Map();
    const summary = { newPeople: [], matchedPeople: [], added: 0, skipped: 0, firstPersonId: '' };

    incoming.people.forEach((p, i) => {
      const where = '사람 ' + (i + 1) + '번째';
      if (!p || typeof p !== 'object') throw Error(where + ' 항목이 잘못되었습니다.');
      const name = text(p.name, 80, where + ' 이름').trim();
      if (!name) throw Error(where + '에 이름이 없습니다.');
      const key = typeof p.id === 'string' && p.id ? p.id : name;
      if (map.has(key)) throw Error('가져오기 파일에 같은 사람(' + name + ')이 두 번 있습니다.');
      const same = data.people.find(x => (typeof p.id === 'string' && x.id === p.id) || norm(x.name) === norm(name));
      if (same) { map.set(key, same.id); summary.matchedPeople.push(same.name); return; }
      const birth = text(p.birth, 10, where + ' 출생일');
      if (birth && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth)) throw Error(where + ' 출생일은 YYYY-MM-DD 형식이어야 합니다.');
      const id = typeof p.id === 'string' && p.id && !data.people.some(x => x.id === p.id) ? p.id : newId();
      const gender = ['M', '남', '남자', 'male'].includes(p.gender) ? 'M' : ['F', '여', '여자', 'female'].includes(p.gender) ? 'F' : '';
      data.people.push({ id, name, gender, birth, bio: text(p.bio, 2000, where + ' 소개'), parents: [], spouse: '', _src: p });
      map.set(key, id);
      summary.newPeople.push(name);
    });

    // 새로 들어온 사람의 부모·배우자 연결(파일 안의 id 또는 이름, 기존 사람의 id 또는 이름으로 지정)
    const resolve = ref => {
      if (typeof ref !== 'string' || !ref) return '';
      if (map.has(ref)) return map.get(ref);
      const found = data.people.find(x => !x._src && (x.id === ref || norm(x.name) === norm(ref)));
      return found ? found.id : '';
    };
    for (const p of data.people.filter(x => x._src)) {
      const src = p._src; delete p._src;
      p.parents = [...new Set((Array.isArray(src.parents) ? src.parents : []).map(resolve).filter(id => id && id !== p.id))];
      const partnerId = resolve(src.spouse);
      const partner = data.people.find(x => x.id === partnerId && x.id !== p.id);
      if (partner && (!partner.spouse || partner.spouse === p.id)) { p.spouse = partner.id; partner.spouse = p.id; }
    }
    const byId = new Map(data.people.map(x => [x.id, x])), done = new Set(), visiting = new Set();
    const visit = id => {
      if (visiting.has(id)) throw Error('가져오기 파일의 부모·자녀 관계가 서로 엇갈립니다. 관계를 확인해 주세요.');
      if (done.has(id)) return;
      visiting.add(id); for (const parent of byId.get(id)?.parents || []) visit(parent); visiting.delete(id); done.add(id);
    };
    data.people.forEach(x => visit(x.id));

    incoming.events.forEach((e, i) => {
      const where = '기록 ' + (i + 1) + '번째';
      if (!e || typeof e !== 'object') throw Error(where + ' 항목이 잘못되었습니다.');
      const personId = map.get(e.personId) || resolve(e.personId) || resolve(e.person);
      if (!personId) throw Error(where + '의 사람(' + String(e.personId || e.person || '없음') + ')을 찾지 못했습니다.');
      const date = text(e.date, 10, where + ' 시기').trim();
      if (!DATE.test(date)) throw Error(where + '의 시기는 1990, 1990-03, 1990-03-21 같은 형식이어야 합니다.');
      const title = text(e.title, 160, where + ' 제목').trim();
      if (!title) throw Error(where + '에 제목이 없습니다.');
      const event = {
        id: typeof e.id === 'string' && e.id ? e.id : newId(),
        personId, date, title,
        stage: STAGES.includes(e.stage) ? e.stage : '기타',
        place: text(e.place, 160, where + ' 장소'),
        body: text(e.body, 30000, where + ' 이야기'),
        source: text(e.source, 500, where + ' 자료 출처'),
        photos: (Array.isArray(e.photos) ? e.photos : []).filter(ph => ph && typeof ph.url === 'string' && PHOTO.test(ph.url)).map(ph => ({ url: ph.url, caption: typeof ph.caption === 'string' ? ph.caption.slice(0, 200) : '' }))
      };
      const exists = data.events.some(x => x.id === event.id || (x.personId === personId && x.date === date && x.title === title));
      if (exists) { summary.skipped++; return; }
      data.events.push(event);
      summary.added++;
    });
    summary.firstPersonId = map.values().next().value || '';
    return { data, summary };
  }

  function describe(s) {
    const lines = [];
    if (s.newPeople.length) lines.push('새 가족 ' + s.newPeople.length + '명: ' + s.newPeople.join(', '));
    if (s.matchedPeople.length) lines.push('이미 있는 가족에 붙임: ' + s.matchedPeople.join(', '));
    lines.push('추가할 기록 ' + s.added + '건' + (s.skipped ? ', 이미 있어 건너뛸 기록 ' + s.skipped + '건' : ''));
    return lines.join('\n');
  }

  return { merge, describe, parse };
}));

// 화면 연결 (브라우저에서만). app.js의 data, personId, render, save 등을 사용합니다.
if (typeof document !== 'undefined') {
  const button = document.querySelector('#importRecords'), input = document.querySelector('#importFile');
  if (button && input) {
    button.onclick = () => { if (busy) { notice('저장 중입니다. 잠시 후 다시 시도해 주세요.'); return; } input.value = ''; input.click(); };
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const { data: next, summary } = FamilyImport.merge(data, await file.text());
        if (!summary.added && !summary.newPeople.length) { notice('가져올 새 기록이 없습니다. 모두 이미 들어 있습니다(' + summary.skipped + '건).'); return; }
        if (!confirm('「' + file.name + '」을(를) 가져옵니다.\n\n' + FamilyImport.describe(summary) + '\n\n가져온 뒤 바로 암호화해 저장합니다. 계속할까요?')) return;
        data = next;
        if (summary.firstPersonId) personId = summary.firstPersonId;
        stage = '전체 기록'; currentView = 'records'; dirty = true;
        render();
        await save();
      } catch (e) {
        notice('가져오기 실패 · ' + e.message);
      }
    };
  }
}
