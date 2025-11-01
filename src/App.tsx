// src/App.tsx
import React from "react";
import { Routes, Route, Link } from "react-router-dom";
import TeacherPage from "./pages/TeacherPage";
import StudentPage from "./pages/StudentPage";

export default function App() {
    return (
        <div style={{ minHeight: "100vh", background: "#0f172a", color: "white" }}>
            <header style={{ padding: "12px 16px", borderBottom: "1px solid #1f2937" }}>
                <strong>PPT Sync MVP</strong>
                <nav style={{ marginTop: 8, display: "flex", gap: 12 }}>
                    <Link to="/teacher">교사 화면</Link>
                    <Link to="/student">학생 화면</Link>
                </nav>
            </header>
            <main style={{ padding: 16 }}>
                <Routes>
                    <Route path="/teacher" element={<TeacherPage />} />
                    <Route path="/student" element={<StudentPage />} />
                    <Route path="*" element={<div>경로를 선택하세요.</div>} />
                </Routes>
            </main>
        </div>
    );
}
