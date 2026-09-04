import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import pkg from "./package.json";

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  define: {
    // 설정 > 정보 카드의 버전 — 출처는 package.json 하나 (릴리스 때 버전 파일을 늘리지 않는다)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // cargo 빌드 산출물 잠금(EBUSY)으로 워처가 죽는 것을 방지 — Tauri 템플릿과 동일
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
  },
});
