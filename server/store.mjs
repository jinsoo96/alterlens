// 테마 정의와 변환 세션 저장소. 파일 기반(서버 1대 전제, Ailism 으로 옮길 땐 DB 테이블로).
//   server/themes/<id>.json           테마 정의(git): id · name · enabled · live · style · variants · refs
//   server/data/themes/<id>/*.jpg     스튜디오에서 만든 예시(후보·기준 그림)
//   server/data/sessions/<id>.json    변환 세션: 단계(원본 → 테마 → 채팅…)와 현재 단계
//   server/data/media/<id>-<n>.<ext>  단계별 결과
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
export const extOf = (type) => EXT[(type || '').split(';')[0]] ?? '.jpg';

export async function openStore(root) {
  const dirs = {
    themes: path.join(root, 'themes'),
    themeMedia: path.join(root, 'data', 'themes'),
    sessions: path.join(root, 'data', 'sessions'),
    media: path.join(root, 'data', 'media'),
  };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

  const themeFile = (id) => path.join(dirs.themes, `${id}.json`);
  const checkId = (id) => {
    if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error('id 는 소문자·숫자·하이픈 2~40자');
  };

  const themes = {
    async all() {
      const out = [];
      for (const f of (await readdir(dirs.themes)).filter((x) => x.endsWith('.json'))) {
        try {
          out.push(JSON.parse(await readFile(path.join(dirs.themes, f), 'utf8')));
        } catch (e) {
          console.error(`theme ${f}: ${e.message}`);
        }
      }
      return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id));
    },
    async get(id) {
      checkId(id);
      return existsSync(themeFile(id)) ? JSON.parse(await readFile(themeFile(id), 'utf8')) : null;
    },
    async save(t) {
      checkId(t.id);
      await writeFile(themeFile(t.id), JSON.stringify(t, null, 2) + '\n', 'utf8');
    },
    mediaDir(id) {
      checkId(id);
      return path.join(dirs.themeMedia, id);
    },
    /** 앱에 내보내는 공개 정보(그림체 문장·변형 문장은 서버에만) */
    publicView(t) {
      return {
        id: t.id,
        name: t.name,
        live: t.live ?? null,
        examples: (t.refs ?? []).map((f) => `/api/v1/theme-media/${t.id}/${f}`),
      };
    },
  };

  const sessionFile = (id) => path.join(dirs.sessions, `${id}.json`);
  const sessions = {
    async get(id) {
      if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(sessionFile(id))) return null;
      return JSON.parse(await readFile(sessionFile(id), 'utf8'));
    },
    async save(s) {
      s.updated = Date.now();
      await writeFile(sessionFile(s.id), JSON.stringify(s, null, 2), 'utf8');
    },
    async putMedia(name, bytes) {
      await writeFile(path.join(dirs.media, name), bytes);
    },
    async readMedia(name) {
      return readFile(path.join(dirs.media, name));
    },
    /** 앱에 내보내는 세션 상태 */
    view(s) {
      const last = s.steps.at(-1);
      return {
        id: s.id,
        theme: s.theme,
        status: last.status,
        current: s.current,
        steps: s.steps.map((st) => ({
          n: st.n,
          kind: st.kind,
          text: st.text ?? null,
          status: st.status,
          url: st.file ? `/api/v1/media/${st.file}` : null,
          error: st.error ?? null,
        })),
      };
    },
  };

  return { dirs, themes, sessions };
}
