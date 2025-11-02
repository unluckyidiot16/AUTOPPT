// src/pages/LoginPage.tsx
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [pw, setPw] = useState("");
    const [error, setError] = useState<string | null>(null);
    const nav = useNavigate();
    const [sp] = useSearchParams();
    const next = sp.get("next") || "/teacher";

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) nav(next, { replace: true });
        });
    }, [nav, next]);

    async function signIn(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) setError(error.message);
        else nav(next, { replace: true });
    }

    return (
        <form onSubmit={signIn} className="max-w-sm mx-auto p-6 space-y-3">
            <h1 className="text-xl font-bold">교사 로그인</h1>
            <input className="w-full border rounded px-3 py-2" placeholder="이메일" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full border rounded px-3 py-2" placeholder="비밀번호" type="password" value={pw} onChange={e=>setPw(e.target.value)} />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button className="w-full rounded px-3 py-2 bg-blue-600 hover:bg-blue-500">로그인</button>
        </form>
    );
}
