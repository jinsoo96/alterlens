// 테마 레시피 → 편집 지시문. 테마의 그림체 문장 + 색 조합 + 앱이 본 장면(인원·표정·장식)을 짧은 영어 지시문으로 만든다.
// Ailism 지시문 한도(500자)에 맞춰, 넘치면 장면 문장부터 줄인다.

const EXPR = {
  smile: 'smiling',
  wink: 'winking',
  surprise: 'looking surprised',
  mouthOpen: 'with an open mouth',
  frown: 'frowning',
  pucker: 'making a kissy face',
};
const SIDE = (x) => (x < 0.36 ? 'on the left' : x > 0.64 ? 'on the right' : 'in the middle');

/** scene: { people, faces: [{ x, expr: string[], decor? }], variant } (앱이 촬영 순간에 보낸 것) */
export function sceneSentences(scene) {
  if (!scene) return [];
  const out = [];
  const n = Math.max(scene.people ?? 0, scene.faces?.length ?? 0);
  if (n) out.push(n === 1 ? 'There is one person.' : `There are ${n} people.`);
  // 얼굴마다 한 문장: 미리보기와 결과를 잇는 장식을 먼저, 그다음 표정
  let anyExpr = false;
  for (const f of scene.faces ?? []) {
    const who = scene.faces.length > 1 ? `The person ${SIDE(f.x)}` : 'The person';
    const ex = (f.expr ?? []).map((e) => EXPR[e]).filter(Boolean);
    anyExpr ||= ex.length > 0;
    const parts = [f.decor ? `wears ${f.decor}` : '', ex.length ? `is ${ex.join(' and ')}` : ''].filter(Boolean);
    if (parts.length) out.push(`${who} ${parts.join(' and ')}.`);
  }
  if (anyExpr) out.push('Keep their expressions.');
  return out;
}

export function themePrompt(theme, { variant, scene, maxLen, withRefs }) {
  const head = [
    `Redraw this entire photo as ${theme.style}`,
    variant && theme.variants?.[variant] ? theme.variants[variant] : '',
    'Keep the same people, faces, poses and composition.',
    withRefs ? 'Match the art style of the reference images.' : '',
  ].filter(Boolean).join(' ');
  const scenes = sceneSentences(scene);
  let text = head;
  for (const s of scenes) {
    if ((text + ' ' + s).length > maxLen) break;
    text += ' ' + s;
  }
  return text.slice(0, maxLen);
}

export function chatPrompt(theme, message, maxLen) {
  const tail = ` Keep the same ${theme.name} art style, people and composition; change nothing else.`;
  return (message.trim().slice(0, maxLen - tail.length) + tail).slice(0, maxLen);
}
