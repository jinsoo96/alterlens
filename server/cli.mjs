// 서버 테마 관리. 파일만 바꾸므로 서버를 다시 켜지 않아도 앱이 다음에 열 때 바로 반영된다.
//
//   node server/cli.mjs list
//   node server/cli.mjs on <id> | off <id>                    테마 꼈다 켰다
//   node server/cli.mjs new <id> --name 이름 --preview <앱 테마 id> --prompt "..." [--model alibaba/qwen-image-3/edit]
//   node server/cli.mjs set <id> <경로> <값>                   예) set anime video.preset_id <uuid>
//   node server/cli.mjs presets                                Higgsfield Restyle 스타일 목록(영상 테마 후보, 키 필요)
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themeStore } from './themes.mjs';
import { higgsfield } from './providers/higgsfield.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, 'server', '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const store = themeStore(path.join(ROOT, 'server', 'themes'));
const [cmd, id, ...rest] = process.argv.slice(2);
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function need(themeId) {
  const t = await store.get(themeId);
  if (!t) throw new Error(`없는 테마: ${themeId}`);
  return t;
}

switch (cmd) {
  case 'list': {
    for (const t of await store.all()) {
      const video = t.video ? (t.video.preset_id ? `video:${t.video.preset_id.slice(0, 8)}` : 'video:(preset 없음)') : '';
      console.log(`${t.enabled ? 'ON ' : 'off'}  ${t.id.padEnd(12)} ${t.name.padEnd(12)} preview=${t.preview}  ${t.photo ? `photo:${t.photo.model}` : ''}  ${video}`);
    }
    break;
  }
  case 'on':
  case 'off': {
    const t = await need(id);
    t.enabled = cmd === 'on';
    await store.save(t);
    console.log(`${t.id}: ${cmd}`);
    break;
  }
  case 'new': {
    if (await store.get(id)) throw new Error(`이미 있음: ${id}`);
    const prompt = flag('prompt');
    if (!prompt) throw new Error('--prompt 가 필요하다');
    await store.save({
      id,
      name: flag('name') ?? id.toUpperCase(),
      enabled: false,
      preview: flag('preview') ?? 'anime',
      photo: { model: flag('model') ?? 'alibaba/qwen-image-3/edit', prompt, params: { resolution: '1k', prompt_extend: false, enable_thinking: false } },
    });
    console.log(`${id}: 만들었다(꺼진 상태). 확인 뒤 on ${id}`);
    break;
  }
  case 'set': {
    const [key, raw] = rest;
    const t = await need(id);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    const parts = key.split('.');
    let o = t;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
    await store.save(t);
    console.log(`${t.id}.${key} = ${JSON.stringify(value)}`);
    break;
  }
  case 'presets': {
    const hf = higgsfield(process.env);
    if (!hf.ready) throw new Error('HF_API_KEY_ID · HF_API_KEY_SECRET 가 없다(server/.env.local)');
    const r = await hf.presets();
    for (const p of r.items) console.log(`${p.id}  ${p.name}`);
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n'));
}
