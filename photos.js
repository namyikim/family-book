// 사진 따로 저장하기
// - 예전에는 사진이 기록 파일(family.enc.json) 안에 data:image… 글자로 함께 들어가 전체 8MB 한도에 걸렸습니다.
// - 이제 저장할 때 사진마다 새 열쇠(AES-256-GCM)를 만들어 사진만 따로 암호화하고, 비공개 저장소의
//   photos/<번호>.enc.json 파일로 올립니다. 기록 파일에는 { ref, key, type, caption }만 남습니다.
// - 사진 열쇠는 기록 파일 안에만 있으므로 기록 비밀번호 없이는 사진도 열 수 없습니다.
// - 예전 방식(url에 사진이 들어 있는 기록)도 그대로 보이며, 다음 저장 때 자동으로 따로 옮겨집니다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyPhotos = api;
}(globalThis, () => {
  'use strict';
  const INLINE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
  const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const KEY = /^[A-Za-z0-9+/]{43}=$/;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const C = () => globalThis.FamilyCrypto || require('./crypto.js');
  const isInline = p => !!p && typeof p.url === 'string' && INLINE.test(p.url);
  const isStored = p => !!p && typeof p.ref === 'string' && REF.test(p.ref) && typeof p.key === 'string' && KEY.test(p.key) && TYPES.includes(p.type);
  const path = ref => '/contents/photos/' + ref + '.enc.json';
  function fromDataUrl(url) {
    const m = INLINE.exec(url);
    if (!m) throw new Error('사진 형식이 올바르지 않습니다.');
    return { type: 'image/' + m[1], bytes: C().fromBase64(m[2]) };
  }
  const toDataUrl = (bytes, type) => 'data:' + type + ';base64,' + C().toBase64(bytes);
  // 사진 글자를 빼고 잰 기록 크기(8MB 한도는 이제 글에만 적용됩니다).
  function recordSize(d) {
    return new TextEncoder().encode(JSON.stringify(d, (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:image/') ? '' : v))).length;
  }
  async function seal(bytes, type) {
    if (!TYPES.includes(type)) throw new Error('사진은 JPG·PNG·WebP만 저장할 수 있습니다.');
    const ref = crypto.randomUUID(), raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(ref) }, key, bytes));
    return { photo: { ref, key: C().toBase64(raw), type }, envelope: { version: 1, kind: 'family-photo', alg: 'AES-256-GCM', iv: C().toBase64(iv), ciphertext: C().toBase64(ciphertext) } };
  }
  async function open(envelope, photo) {
    if (!isStored(photo)) throw new Error('사진 정보가 올바르지 않습니다.');
    if (!envelope || envelope.version !== 1 || envelope.kind !== 'family-photo' || envelope.alg !== 'AES-256-GCM') throw new Error('지원하지 않는 사진 파일입니다.');
    const iv = C().fromBase64(envelope.iv), ciphertext = C().fromBase64(envelope.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16) throw new Error('사진 파일이 손상되었습니다.');
    try {
      const key = await crypto.subtle.importKey('raw', C().fromBase64(photo.key), 'AES-GCM', false, ['decrypt']);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(photo.ref) }, key, ciphertext));
    } catch { throw new Error('사진 파일이 손상되었거나 다른 사진입니다.'); }
  }
  return { isInline, isStored, path, fromDataUrl, toDataUrl, recordSize, seal, open };
}));
