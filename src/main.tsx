// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
// ✅ 변경: BrowserRouter 대신 HashRouter
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <HashRouter>
            <App />
        </HashRouter>
    </React.StrictMode>
);
