import { cyberpunk } from './cyberpunk';
import type { Theme } from './types';

// 새 테마는 themes/<이름>/ 에 Theme 을 만들고 여기에 한 줄 추가하면 화면의 테마 줄에 나온다.
export const THEMES: Theme[] = [cyberpunk];
