// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    base: process.env.GITHUB_PAGES ? '/AUTOPPT/' : '/',
    server: {
        host: true,
        port: 5173,
    },
    resolve: {
        dedupe: ["react", "react-dom"],     // ✅ 중복 로딩 차단
    },
    optimizeDeps: {
        include: ["react", "react-dom", "react-router-dom"],
        exclude: [],                        // 혹시 react를 exclude 해뒀다면 제거
    },
});
