// src/roles.tsx  (드롭-인 교체)
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
const RoleContext = createContext<Ctx | null>(null);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [role, setRole] = useState<Role>((localStorage.getItem(KEY_ROLE) as Role) || "student");
    const [teacherKey, setTeacherKey] = useState<string | undefined>(localStorage.getItem(KEY_TKEY) || undefined);

    useEffect(() => localStorage.setItem(KEY_ROLE, role), [role]);
    useEffect(() => {
        if (teacherKey) localStorage.setItem(KEY_TKEY, teacherKey);
        else localStorage.removeItem(KEY_TKEY);
    }, [teacherKey]);

    const setStudent = () => { setRole("student"); setTeacherKey(undefined); };
    const setTeacher = (key: string) => { setTeacherKey(key); setRole("teacher"); };

    const expected = import.meta.env.VITE_TEACHER_PIN || import.meta.env.VITE_TEACHER_KEY;
    const hasValidTeacherKey = !!teacherKey && (!!expected ? teacherKey === expected : true);

    return (
        <RoleContext.Provider value={{
            role,
            isTeacher: role === "teacher" && hasValidTeacherKey,
            setStudent,
            setTeacher,
            hasValidTeacherKey,
            teacherKey,
        }}>
            {children}
        </RoleContext.Provider>
    );
};

export function useRole() {
    const ctx = useContext(RoleContext);
    if (!ctx) throw new Error("useRole must be used within <RoleProvider>");
    return ctx;
}

// ⚠️ 여기서는 더 이상 RequireTeacher를 export 하지 않습니다.
