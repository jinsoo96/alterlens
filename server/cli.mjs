// 서버 테마 빠른 관리(화면은 /studio). 파일만 바꾸므로 서버를 다시 켜지 않아도 앱이 다음에 열 때 반영된다.
//   node server/cli.mjs list
//   node server/cli.mjs on <id> | off <id>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';

const store = await openStore(path.dirname(fileURLToPath(import.meta.url)));
const [cmd, id] = process.argv.slice(2);

if (cmd === 'list') {
  for (const t of await store.themes.all()) {
    console.log(`${t.enabled ? 'ON ' : 'off'}  ${t.id.padEnd(12)} ${t.name.padEnd(12)} live=${t.live ?? '-'}  refs=${t.refs?.length ?? 0}`);
  }
} else if (cmd === 'on' || cmd === 'off') {
  const t = await store.themes.get(id);
  if (!t) throw new Error(`없는 테마: ${id}`);
  t.enabled = cmd === 'on';
  await store.themes.save(t);
  console.log(`${t.id}: ${cmd}`);
} else {
  console.log('node server/cli.mjs list | on <id> | off <id>   (테마 만들기·예시 고르기는 /studio)');
}
