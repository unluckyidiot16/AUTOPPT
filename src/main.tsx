// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
// import { RoleProvider } from "./roles";  // ❌ 일단 제외
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

// PDF.js 워커 관련 에러를 조용히 처리
if (typeof window !== "undefined") {
    // 전역 에러 핸들러
    window.addEventListener("error", (ev: ErrorEvent) => {
        const msg = String(ev?.error?.message || ev?.message || "");

        // PDF.js 워커 관련 에러들을 무시
        if (
            msg.includes('GlobalWorkerOptions') ||
            msg.includes('pdf.worker') ||
            msg.includes('Worker') ||
            msg.includes('workerSrc')
        ) {
            ev.preventDefault(); // 에러 전파 차단
            console.debug("[PDF.js] Worker-related error suppressed:", msg);
            return;
        }
    }, true);

    // Promise rejection 핸들러
    window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
        const msg = String(ev?.reason?.message || ev?.reason || "");

        if (
            msg.includes('GlobalWorkerOptions') ||
            msg.includes('pdf.worker') ||
            msg.includes('Worker')
        ) {
            ev.preventDefault(); // 에러 전파 차단
            console.debug("[PDF.js] Worker-related rejection suppressed:", msg);
            return;
        }
    });
}

ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
        <HashRouter>
            {/* <RoleProvider> */}
            <App />
            {/* </RoleProvider> */}
        </HashRouter>
    </React.StrictMode>
);