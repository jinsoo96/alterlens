import type { CapacitorConfig } from '@capacitor/cli';

// 아이폰 앱 껍데기: 같은 웹앱(dist)을 앱 안에 넣어 오프라인으로 돈다.
const config: CapacitorConfig = {
  appId: 'com.jinsoo96.alterlens',
  appName: 'ALTERLENS',
  webDir: 'dist',
  ios: { contentInset: 'never' },
};

export default config;
