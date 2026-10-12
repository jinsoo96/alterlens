// 키 없이 전체 흐름(업로드 → 작업 → 폴링 → 결과)을 시험하는 가짜 공급자. 잠깐 기다렸다가 입력을 그대로 돌려준다.
export function mock() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    name: 'mock',
    ready: true,
    async photo({ bytes, contentType }) {
      await wait(1500);
      return { bytes, contentType };
    },
    async video({ bytes, contentType }) {
      await wait(1500);
      return { bytes, contentType };
    },
    async presets() {
      return { model: 'mock', items: [{ id: '00000000-0000-0000-0000-000000000000', name: 'Mock Preset', preview_url: '' }] };
    },
    async estimate() {
      return { credits: '0', usd: '0' };
    },
  };
}
