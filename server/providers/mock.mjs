// 키 없이 전체 흐름(테마 적용 → 채팅 다듬기 → 스튜디오 예시)을 시험하는 가짜 공급자.
// 잠깐 기다렸다가 입력 사진을 그대로 돌려준다. 프롬프트는 마지막 것을 기억해 시험에서 확인할 수 있게 한다.
export function mock() {
  const state = { lastPrompt: '', calls: 0 };
  return {
    name: 'mock',
    ready: true,
    caps: { refs: 9, maxPrompt: 4000 },
    state,
    async edit({ image, prompt }) {
      state.lastPrompt = prompt;
      state.calls++;
      await new Promise((r) => setTimeout(r, 1200));
      return { bytes: image.bytes, type: image.type };
    },
  };
}
