// src/App.tsx (핵심만 확인)
import { Routes, Route, Navigate } from "react-router-dom";
import RequireTeacher from "./auth/RequireTeacher";
import TeacherPage from "./pages/TeacherPage";
import StudentPage from "./pages/StudentPage";
import LoginPage from "./pages/LoginPage";
import PdfLibraryPage from "./pages/PdfLibraryPage";

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/student" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/student" element={<StudentPage />} />
            <Route
                path="/teacher"
                element={
                    <RequireTeacher>
                        <TeacherPage />
                    </RequireTeacher>
                }
            />
            <Route
                path="/library"
                element={
                    <RequireTeacher>
                        <PdfLibraryPage />
                    </RequireTeacher>
                }
            />
            <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
    );
}
