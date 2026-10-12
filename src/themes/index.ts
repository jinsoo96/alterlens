import { anime } from './anime';
import { cyberpunk } from './cyberpunk';
import { plain } from './plain';
import type { Theme } from './types';

// 새 테마는 themes/<이름>/ 에 Theme 을 만들고 여기에 한 줄 추가하면 화면의 테마 줄에 나온다.
// 그림체 테마는 kit/toon.ts 의 ToonSpec 값만 채워 toonGlsl() 로 픽셀 규칙을 만든다(anime 참고).
export const THEMES: Theme[] = [cyberpunk, anime, plain];
