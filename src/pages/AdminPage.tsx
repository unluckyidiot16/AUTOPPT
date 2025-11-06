// src/pages/AdminPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";

type RoomRow = { id: string; code: string; owner_id: string | null; created_at: string; state: any; current_deck_id: string | null };
type OrphanDeck = { id: string; title: string | null; file_key: string | null; created_at: string };

export default function AdminPage() {
    const nav = useNavigate();
    const [rooms, setRooms] = useState<RoomRow[]>([]);
    const [orphans, setOrphans] = useState<OrphanDeck[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                // 로그인 확인
                const { data: s } = await supabase.auth.getSession();
                if (!s.session) return nav("/login?next=/admin");
                // 방 목록
                const { data: rs } = await supabase
                    .from("rooms")
                    .select("id, code, owner_id, created_at, state, current_deck_id")
                    .order("created_at", { ascending: false });
                setRooms((rs as any) ?? []);

                // 고아 자료(예: room_decks에 매핑되지 않은 decks)
                const { data: ods } = await supabase.rpc("list_orphan_decks"); // 없으면 나중에 만들 RPC
                setOrphans((ods as any) ?? []);
            } finally { setLoading(false); }
        })();
    }, [nav]);

    return (
        <div style={{ padding:12, display:"grid", gap:12 }}>
            <div className="topbar"><h1>Admin</h1></div>

            <div className="panel">
                <div style={{ fontWeight:700, marginBottom:8 }}>방</div>
                {rooms.length === 0 ? <div style={{ opacity:0.6 }}>{loading ? "불러오는 중…" : "방이 없습니다."}</div> : (
                    <div style={{ display:"grid", gap:8 }}>
                        {rooms.map(r => (
                            <div key={r.id} style={{ display:"grid", gridTemplateColumns:"160px 1fr auto", gap:8 }}>
                                <span className="badge">code: {r.code}</span>
                                <div style={{ fontSize:12, opacity:0.8 }}>
                                    deck: {r.current_deck_id ? r.current_deck_id.slice(0,8) + "…" : "없음"} · p.{r.state?.page ?? 1}
                                </div>
                                <div style={{ display:"flex", gap:6 }}>
                                    <button className="btn" onClick={() => nav(`/teacher?room=${r.code}&mode=present`)}>바로가기</button>
                                    <button className="btn" onClick={async () => {
                                        await supabase.rpc("goto_page", { p_code: r.code, p_page: 1 });
                                    }}>1페이지로</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="panel">
                <div style={{ fontWeight:700, marginBottom:8 }}>고아 자료</div>
                {orphans.length === 0 ? <div style={{ opacity:0.6 }}>없음</div> : (
                    <div style={{ display:"grid", gap:8 }}>
                        {orphans.map(d => (
                            <div key={d.id} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8 }}>
                                <div>{d.title ?? d.id} <span className="badge">id: {d.id.slice(0,8)}…</span></div>
                                <div style={{ display:"flex", gap:6 }}>
                                    <button className="btn" onClick={() => nav(`/editor?deck=${d.id}`)}>편집</button>
                                    <button className="btn" onClick={async () => {
                                        await supabase.from("decks").delete().eq("id", d.id);
                                    }}>삭제</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
