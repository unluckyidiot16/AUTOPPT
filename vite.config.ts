// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    base: "/AUTOPPT/", // <= 레포 이름
    server: {
        host: true,
        port: 5173,
    },
    resolve: {
        dedupe: ["react", "react-dom"],     // ✅ 중복 로딩 차단
        alias: {
            // PDF.js 워커 파일 무시 - 워커 로딩 시도 자체를 차단
            'pdfjs-dist/build/pdf.worker.js': false,
            'pdfjs-dist/build/pdf.worker.min.js': false,
            'pdfjs-dist/build/pdf.worker.entry': false,
        }
    },
    optimizeDeps: {
        include: [
            "react",
            "react-dom",
            "react-router-dom",
            "pdfjs-dist/legacy/build/pdf",  // legacy 빌드 미리 최적화
            "pdfjs-dist/build/pdf"          // 표준 빌드도 미리 최적화
        ],
        exclude: [
            'pdfjs-dist/build/pdf.worker.js',     // 워커 제외
            'pdfjs-dist/build/pdf.worker.min.js'  // 워커 제외
        ],
        esbuildOptions: {
            // ESBuild에서도 워커 관련 경고 무시
            logOverride: {
                'unsupported-dynamic-import': 'silent'
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                // PDF.js를 별도 청크로 분리
                manualChunks: {
                    'pdfjs': ['pdfjs-dist']
                }
            },
            // 워커 파일 번들링 제외
            external: [
                /pdf\.worker\.js$/,
                /pdf\.worker\.min\.js$/
            ]
        }
    }
});