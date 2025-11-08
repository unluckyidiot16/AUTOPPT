// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
    base: "/AUTOPPT/",
    plugins: [
        react(),
        // pdf.js가 문서 열 때 필요한 리소스들을 동일 출처로 복사
        viteStaticCopy({
            targets: [
                // ★ fake worker가 동적 import할 ESM 워커(.mjs)
                { src: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs", dest: "pdfjs/build" },
                // ★ CMAP / 표준 폰트(동일 출처)
                { src: "node_modules/pdfjs-dist/cmaps",          dest: "pdfjs" },
                { src: "node_modules/pdfjs-dist/standard_fonts", dest: "pdfjs" },
            ],
        }),
    ],

    server: { host: true, port: 5173 },

    resolve: {
        dedupe: ["react", "react-dom"],
        alias: {
            // 번들에 JS 워커가 끼어드는 걸 차단(우리는 런타임에 .mjs를 동일 출처에서 로드)
            "pdfjs-dist/build/pdf.worker.js": false,
            "pdfjs-dist/build/pdf.worker.min.js": false,
            "pdfjs-dist/build/pdf.worker.entry": false,
        },
    },

    optimizeDeps: {
        // v5 ESM 본체만 프리번들. (legacy/worker 제외)
        include: ["react", "react-dom", "react-router-dom", "pdfjs-dist/build/pdf"],
        exclude: [
            "pdfjs-dist/build/pdf.worker.js",
            "pdfjs-dist/build/pdf.worker.min.js",
            "pdfjs-dist/build/pdf.worker.min.mjs",
        ],
        esbuildOptions: { logOverride: { "unsupported-dynamic-import": "silent" } },
    },

    build: {
        rollupOptions: {
            output: {
                // pdf.js를 별도 청크로 분리(선택 사항이지만, 초기 로드 안정성/캐싱에 유리)
                manualChunks: { pdfjs: ["pdfjs-dist/build/pdf"] },
            },
        },
    },
});
