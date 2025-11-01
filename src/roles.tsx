// src/roles.tsx
import React, { createContext, useContext, useEffect, useState } from "react";

type Role = "student" | "teacher";
type Ctx = {
    role: Role;
    isTeacher: boolean;
    setStudent: () => void;
    setTeacher: (key: string) => void;
    hasValidTeacherKey: boolean;
    teacherKey?: string;
};

const KEY_ROLE = "autoppt.role";
const KEY_TKEY = "autoppt.teacherKey";
const RoleContext = createContext<Ctx>(null!);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [role, setRole] = useState<Role>(
        (localStorage.getItem(KEY_ROLE) as Role) || "student"
    );
    const [teacherKey, setTeacherKey] = useState<string | undefined>(
        localStorage.getItem(KEY_TKEY) || undefined
    );

    useEffect(() => localStorage.setItem(KEY_ROLE, role), [role]);
    useEffect(() => {
        if (teacherKey) localStorage.setItem(KEY_TKEY, teacherKey);
        else localStorage.removeItem(KEY_TKEY);
    }, [teacherKey]);

    const setStudent = () => {
        setRole("student");
        setTeacherKey(undefined);
    };
    const setTeacher = (key: string) => {
        setTeacherKey(key);
        setRole("teacher");
    };

    // .env 에서 VITE_TEACHER_PIN(or KEY) 제공 시 검증
    const expected = import.meta.env.VITE_TEACHER_PIN || import.meta.env.VITE_TEACHER_KEY;
    const hasValidTeacherKey = !!teacherKey && (!!expected ? teacherKey === expected : true);

    return (
        <RoleContext.Provider
            value={{
                role,
                isTeacher: role === "teacher" && hasValidTeacherKey,
                setStudent,
                setTeacher,
                hasValidTeacherKey,
                teacherKey,
            }}
        >
            {children}
        </RoleContext.Provider>
    );
};

export const useRole = () => useContext(RoleContext);

// 교사 전용 라우트 가드
export const RequireTeacher: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isTeacher } = useRole();
    const next = location.pathname + location.search;
    if (!isTeacher) {
        return (
            // 잠금 화면으로 리다이렉트
            <a href={`#/unlock?next=${encodeURIComponent(next)}`} style={{ display: "block", padding: 24 }}>
                교사 전용 화면입니다. 이동 중…
            </a>
        );
    }
    return <>{children}</>;
};
