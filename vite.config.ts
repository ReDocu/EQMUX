import { defineConfig } from "vite";

// @ts-expect-error process는 node 전역이다
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Rust 에러가 화면에서 밀려나지 않게 한다
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
