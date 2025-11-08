// vite.config.ts
export default defineConfig({
    plugins: [react()],
    base: "/AUTOPPT/",
    server: { host: true, port: 5173 },
    resolve: {
        dedupe: ["react", "react-dom"],
        alias: {
            // 워커 차단 유지 (우리는 workerless 사용)
            "pdfjs-dist/build/pdf.worker.js": false,
            "pdfjs-dist/build/pdf.worker.min.js": false,
            "pdfjs-dist/build/pdf.worker.entry": false,
        },
    },
    optimizeDeps: {
        include: [
            "react",
            "react-dom",
            "react-router-dom",
            // ⬇️ 레거시 빌드만 남기고
            "pdfjs-dist/legacy/build/pdf",
        ],
        exclude: [
            // ⬇️ worker 제외 유지
            "pdfjs-dist/build/pdf.worker.js",
            "pdfjs-dist/build/pdf.worker.min.js",
        ],
        esbuildOptions: {
            logOverride: { "unsupported-dynamic-import": "silent" },
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: { pdfjs: ["pdfjs-dist/legacy/build/pdf"] },
            },
            external: [
                /pdf\.worker\.js$/,
                /pdf\.worker\.min\.js$/,
            ],
        },
    },
});
