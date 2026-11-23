// 받은 기록함: 기록 비밀번호 없이도 가져오기 파일을 안전하게 보낼 수 있게 합니다.
// - 처음 로그인하면 이 브라우저가 열쇠 한 쌍(ECDH P-256)을 만들어, 개인 열쇠는 암호화된 기록 안(data.inbox)에 두고
//   공개 열쇠만 비공개 저장소의 inbox/public-key.json에 올립니다.
// - 보내는 쪽은 공개 열쇠로 가져오기 파일을 잠가(tools/inbox-seal.cjs) inbox/ 아래에 올립니다. 공개 열쇠로는 잠글 수만 있고 열 수는 없습니다.
// - 로그인할 때 사이트가 inbox/의 파일을 열어 기록 가져오기와 같은 규칙으로 합치고, 확인을 받으면 저장한 뒤 그 파일을 지웁니다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyInbox = api;
}(globalThis, () => {
  'use strict';
  const subtle = globalThis.crypto.subtle, CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const pub = jwk => subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, CURVE, false, []);

  async function newKeys() {
    const k = await subtle.generateKey(CURVE, true, ['deriveBits']);
    const publicJwk = await subtle.exportKey('jwk', k.publicKey), privateJwk = await subtle.exportKey('jwk', k.privateKey);
    return { publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, privateJwk };
  }
  async function aesKey(privateKey, publicKey, salt) {
    const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('family-book inbox v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // 가져오기 파일(문자열 또는 객체)을 공개 열쇠로 잠급니다.
  async function seal(content, publicJwk) {
    const eph = await subtle.generateKey(CURVE, true, ['deriveBits']);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await aesKey(eph.privateKey, await pub(publicJwk), salt);
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    const e = await subtle.exportKey('jwk', eph.publicKey);
    return { version: 1, type: 'family-inbox', epk: { kty: e.kty, crv: e.crv, x: e.x, y: e.y }, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) };
  }
  // 잠긴 파일을 개인 열쇠로 열어 가져오기 파일 내용(문자열)을 돌려줍니다.
  async function open(envelope, privateJwk) {
    if (!envelope || envelope.version !== 1 || envelope.type !== 'family-inbox' || !envelope.epk) throw Error('받은 기록함 파일 형식이 아닙니다.');
    try {
      const priv = await subtle.importKey('jwk', privateJwk, CURVE, false, ['deriveBits']);
      const key = await aesKey(priv, await pub(envelope.epk), unb64(envelope.salt));
      return new TextDecoder('utf-8', { fatal: true }).decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.ciphertext)));
    } catch { throw Error('받은 기록을 열지 못했습니다. 다른 열쇠로 잠갔거나 파일이 손상되었습니다.'); }
  }
  return { newKeys, seal, open };
}));

// 화면 연결 (브라우저에서만). app.js의 data, session, api, save, render, notice 등을 사용합니다.
if (typeof document !== 'undefined') {
  const text = r => r.content ? new TextDecoder().decode(FamilyCrypto.fromBase64(r.content.replace(/\s/g, ''))) : '';
  const missing = e => { if (e.status === 404) return null; throw e; };
  globalThis.checkInbox = async () => {
    if (demo || !session || busy) return;
    try {
      if (!data.inbox || !data.inbox.privateJwk) {
        data.inbox = await FamilyInbox.newKeys(); dirty = true;
        if (!await save()) return;
      }
      const want = JSON.stringify({ version: 1, publicJwk: data.inbox.publicJwk });
      const current = await api('/contents/inbox/public-key.json').then(r => r.json(), missing);
      if (!current || text(current) !== want) {
        const body = { message: 'Publish inbox public key', content: FamilyCrypto.toBase64(new TextEncoder().encode(want)) };
        if (current) body.sha = current.sha;
        await api('/contents/inbox/public-key.json', { method: 'PUT', body: JSON.stringify(body) });
      }
      const list = await api('/contents/inbox').then(r => r.json(), missing) || [];
      const items = list.filter(f => f.type === 'file' && /\.json$/.test(f.name) && f.name !== 'public-key.json');
      if (!items.length) return;
      let next = data; const lines = [];
      for (const item of items) {
        const envelope = await (await api('/contents/inbox/' + encodeURIComponent(item.name), { headers: { Accept: 'application/vnd.github.raw+json' } })).json();
        const { data: merged, summary } = FamilyImport.merge(next, await FamilyInbox.open(envelope, data.inbox.privateJwk));
        next = merged; lines.push('「' + item.name + '」\n' + FamilyImport.describe(summary));
      }
      if (!confirm('받은 기록함에 새 기록 파일이 ' + items.length + '개 있습니다.\n\n' + lines.join('\n\n') + '\n\n지금 합쳐서 암호화해 저장할까요?\n(취소하면 다음 로그인 때 다시 묻습니다.)')) return;
      data = next; dirty = true; render();
      if (!await save()) return;
      for (const item of items) await api('/contents/inbox/' + encodeURIComponent(item.name), { method: 'DELETE', body: JSON.stringify({ message: 'Remove imported inbox file', sha: item.sha }) });
      notice('받은 기록 ' + items.length + '개 파일을 합쳐 저장했습니다 · ' + new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      notice('받은 기록함 확인 실패 · ' + e.message);
    }
  };
}
