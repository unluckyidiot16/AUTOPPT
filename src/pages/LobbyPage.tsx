// src/pages/LobbyPage.tsx
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";

type RoomBrief = { id: string; code: string; title: string | null; created_at: string };

export default function LobbyPage() {
    const nav = useNavigate();
    const [rooms, setRooms] = useState<RoomBrief[]>([]);
    const [title, setTitle] = useState("");
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc("list_my_rooms");
            if (error) throw error;
            setRooms((data || []) as RoomBrief[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const mapRoomBrief = (r: any): RoomBrief => ({
        id: r.id,
        code: r.code,
        title: r.title ?? r.code,
        created_at: r.created_at ?? new Date().toISOString(),
    });

    const createRoom = useCallback(async () => {
        try {
            // 빈 제목일 땐 "" 전달 (과거 RPC 오버로드 모호성 회피)
            const { data, error } = await supabase.rpc("create_room", { p_title: title ?? "" });
            if (error) throw error;
            setTitle("");
            await load();
            // 필요 시 바로 진입:
            // nav(`/teacher?room=${data?.[0]?.code}&mode=setup`);
        } catch (e: any) {
            alert(e?.message || String(e));
        }
    }, [title, load]);

    const enter = (code: string) => nav(`/teacher?room=${code}&mode=setup`);

    const removeRoom = useCallback(async (id: string) => {
        // ① 낙관적 제거(즉시 UI 반영)
        setRooms(prev => prev.filter(r => r.id !== id));

        // ② 서버 삭제
        const { error } = await supabase.rpc("delete_room_deep", { p_room_id: id }); // id는 uuid
        if (error) {
            console.error(error);
            // 실패 시 목록 재동기화로 복구
            await load();
            alert(error.message);
            return;
        }

        // ③ 최종 동기화(안전망)
        await load();
    }, [load]);

    // Realtime: 내 소유 rooms INSERT/UPDATE/DELETE 자동 반영
    useEffect(() => {
        let ch: ReturnType<typeof supabase.channel> | null = null;

        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const uid = u.user?.id;
            if (!uid) return;

            ch = supabase
                .channel(`rooms:list:${uid}`, { config: { broadcast: { self: false } } })
                .on("postgres_changes", {
                    event: "*",
                    schema: "public",
                    table: "rooms",
                    filter: `owner_id=eq.${uid}`,
                }, (ev: any) => {
                    setRooms(prev => {
                        if (ev.eventType === "DELETE") {
                            const oldId = ev.old?.id;
                            return prev.filter(r => r.id !== oldId);
                        }
                        if (ev.eventType === "INSERT") {
                            const nr = mapRoomBrief(ev.new);
                            // 중복 방지 + 상단 삽입
                            if (prev.some(r => r.id === nr.id)) {
                                return prev.map(r => (r.id === nr.id ? nr : r));
                            }
                            return [nr, ...prev];
                        }
                        if (ev.eventType === "UPDATE") {
                            const nr = mapRoomBrief(ev.new);
                            return prev.map(r => (r.id === nr.id ? nr : r));
                        }
                        return prev;
                    });
                })
                .subscribe((status) => {
                    // 최초 구독 시에도 서버 상태와 싱크
                    if (status === "SUBSCRIBED") load();
                });
        })();

        return () => { ch?.unsubscribe(); };
    }, [load]);

    return (
        <div className="app-shell" style={{ maxWidth: 900 }}>
            <h1>로비</h1>

            <div className="panel" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        className="input"
                        placeholder="방 제목(선택)"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                    <button className="btn" onClick={createRoom}>＋ 방 생성</button>
                    <button className="btn" onClick={load} disabled={loading}>
                        {loading ? "갱신 중…" : "목록 새로고침"}
                    </button>
                </div>
            </div>

            <div className="panel">
                <div style={{ fontWeight: 700, marginBottom: 8 }}>내 방</div>
                {rooms.length === 0 ? (
                    <div style={{ opacity: .7 }}>아직 방이 없습니다.</div>
                ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                        {rooms.map(r => (
                            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
                                <div style={{ overflow: "hidden" }}>
                                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {r.title || r.code}
                                    </div>
                                    <div style={{ fontSize: 12, opacity: .7 }}>
                                        {r.code} · {new Date(r.created_at).toLocaleString()}
                                    </div>
                                </div>
                                <button className="btn" onClick={() => enter(r.code)}>입장</button>
                                <button className="btn" onClick={() => removeRoom(r.id)}>삭제</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
