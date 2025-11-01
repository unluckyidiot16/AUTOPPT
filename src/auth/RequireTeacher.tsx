// src/auth/RequireTeacher.tsx
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireTeacher({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);
    const [authed, setAuthed] = useState(false);
    const loc = useLocation();

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setAuthed(!!data.session); // 로그인 여부만으로 '교사' 판단 (교사는 로그인, 학생은 비로그인)
            setReady(true);
        });
    }, []);

    if (!ready) return null;
    if (!authed) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return <>{children}</>;
}
