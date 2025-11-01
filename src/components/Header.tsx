// src/components/Header.tsx (예시)
import { NavLink } from "react-router-dom";
import { useRole } from "../roles";

export default function Header() {
    const { isTeacher } = useRole();
    return (
        <header className="...">
            <nav className="flex gap-3">
                <NavLink to="/student">학생</NavLink>
                {isTeacher && <NavLink to="/teacher">교사</NavLink>}
                {/* 교사 전용 진입은 직접 URL(#/unlock)로만 */}
            </nav>
        </header>
    );
}
