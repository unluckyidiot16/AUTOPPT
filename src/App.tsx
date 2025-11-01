// 변경/추가 import
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireTeacher } from "./roles";
import UnlockTeacher from "./pages/UnlockTeacher";
import TeacherPage from "./pages/TeacherPage";
import StudentPage from "./pages/StudentPage";

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/student" replace />} />
            <Route path="/student" element={<StudentPage />} />
            <Route
                path="/teacher"
                element={
                    <RequireTeacher>
                        <TeacherPage />
                    </RequireTeacher>
                }
            />
            <Route path="/unlock" element={<UnlockTeacher />} />
        </Routes>
    );
}
