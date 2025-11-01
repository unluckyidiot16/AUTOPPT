// src/pages/UnlockTeacher.tsx
import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useRole } from "../roles";

export default function UnlockTeacher() {
    const nav = useNavigate();
    const loc = useLocation();
    const { setTeacher } = useRole();
    const [pin, setPin] = useState("");

    const next = useMemo(() => {
        const sp = new URLSearchParams(loc.search);
        return sp.get("next") || "/teacher";
    }, [loc.search]);

    function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!pin.trim()) return;
        setTeacher(pin.trim());
        nav(next, { replace: true });
    }

    return (
        <div className="p-6 max-w-sm mx-auto">
            <h1 className="text-xl font-bold mb-3">교사 인증</h1>
            <p className="text-sm opacity-80 mb-4">교사용 PIN을 입력하세요.</p>
            <form onSubmit={submit} className="space-y-3">
                <input
                    className="w-full border rounded px-3 py-2 bg-black/10"
                    placeholder="교사 PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoFocus
                />
                <button className="w-full rounded px-3 py-2 bg-blue-600 hover:bg-blue-500">
                    언락
                </button>
            </form>
        </div>
    );
}
