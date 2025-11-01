// src/App.tsx
import React from "react";
import { Routes, Route, Link } from "react-router-dom";
import TeacherPage from "./pages/TeacherPage";
import StudentPage from "./pages/StudentPage";

export default function App() {
    return (
        <>
            <header style={{ padding: 12, borderBottom: "1px solid #1f2937" }}>
                <Link to="/teacher">교사</Link> | <Link to="/student">학생</Link>
            </header>
            <main style={{ padding: 12 }}>
                <Routes>
                    <Route path="/teacher" element={<TeacherPage />} />
                    <Route path="/student" element={<StudentPage />} />
                    <Route path="*" element={<div>경로를 선택하세요.</div>} />
                </Routes>
            </main>
        </>
    );
}
