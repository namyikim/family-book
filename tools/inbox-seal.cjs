#!/usr/bin/env node
// 가져오기 파일을 받은 기록함용으로 잠급니다(공개 열쇠로만 잠그며, 여는 것은 로그인한 사이트만 할 수 있습니다).
// 사용법: node tools/inbox-seal.cjs <family-data의 inbox/public-key.json> <가져오기 파일.json> <잠근 파일.json>
// 잠근 파일을 비공개 저장소 family-data의 inbox/ 아래에 올리면, 다음 로그인 때 사이트가 합칠지 묻습니다.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const I = require(path.join(__dirname, '..', 'import.js')), B = require(path.join(__dirname, '..', 'inbox.js'));
const [keyFile, inFile, outFile] = process.argv.slice(2);
if (!keyFile || !inFile || !outFile) { console.error('사용법: node tools/inbox-seal.cjs public-key.json import.json sealed.json'); process.exit(2); }
(async () => {
  const raw = fs.readFileSync(inFile, 'utf8');
  I.parse(raw); // 형식이 맞지 않으면 여기서 멈춥니다.
  const { publicJwk } = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  fs.writeFileSync(outFile, JSON.stringify(await B.seal(raw, publicJwk)));
  console.log('잠금 완료:', outFile);
})().catch(e => { console.error(e.message); process.exit(1); });
