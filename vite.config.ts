import { defineConfig } from 'vite';

// base './' 로 두면 어느 하위 경로(GitHub Pages 등)에 올려도 그대로 동작한다.
export default defineConfig({
  base: './',
  server: { host: true, port: 7420 },
});
