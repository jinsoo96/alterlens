// 서버 테마 목록: server/themes/<id>.json 한 파일이 테마 하나.
// enabled 로 꼈다 켰다 한다. 요청마다 다시 읽으므로 파일만 바꾸면 서버를 다시 켜지 않아도 바로 반영된다.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function themeStore(dir) {
  async function all() {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
      } catch (e) {
        console.error(`theme ${f}: ${e.message}`);
      }
    }
    return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id));
  }

  return {
    all,
    async get(id) {
      return (await all()).find((t) => t.id === id) ?? null;
    },
    async save(theme) {
      if (!/^[a-z0-9-]+$/.test(theme.id)) throw new Error('id 는 소문자·숫자·하이픈만');
      await writeFile(path.join(dir, `${theme.id}.json`), JSON.stringify(theme, null, 2) + '\n', 'utf8');
    },
    /** 앱에 내보내는 공개 정보(프롬프트·프리셋 id 는 서버에만) */
    publicView(t) {
      return {
        id: t.id,
        name: t.name,
        preview: t.preview,
        photo: !!t.photo,
        video: !!(t.video && t.video.preset_id),
        thumb: t.thumb ?? null,
      };
    },
  };
}
