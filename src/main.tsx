// src/main.tsx  (드롭-인 교체)
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
// import { RoleProvider } from "./roles";  // ❌ 일단 제외
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

if (typeof window !== "undefined") {
    window.addEventListener("error", (ev: any) => {
        const msg = String(ev?.error?.message || ev?.message || "");
        if (msg.includes('GlobalWorkerOptions') || msg.includes('pdf.worker')) {
            console.warn("[PDFJS:WHO-CALLED]", ev?.error?.stack || msg);
        }
    }, true);
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
