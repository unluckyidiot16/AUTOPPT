// src/main.tsx (드롭-인)
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { RoleProvider } from "./roles";
import App from "./App";
import "./index.css";

const el = document.getElementById("root");
if (!el) {
    // 안전 가드: 루트 노드 없을 때 깔끔히 중단
    throw new Error("Root element #root not found");
}

ReactDOM.createRoot(el).render(
    <React.StrictMode>
        <HashRouter>
            <RoleProvider>
                <App />
            </RoleProvider>
        </HashRouter>
    </React.StrictMode>
);
