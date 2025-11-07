// src/pages/LobbyPage.tsx
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";

type RoomBrief = { id: string; code: string; title: string; created_at: string };

export default function LobbyPage() {
    const nav = useNavigate();
    const [rooms, setRooms] = useState<RoomBrief[]>([]);
    const [title, setTitle] = useState("");

    const load = useCallback(async () => {
        const { data, error } = await supabase.rpc("list_my_rooms");
        if (!error) setRooms(data || []);
    }, []);
    useEffect(() => { load(); }, [load]);

    const createRoom = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc("create_room", { p_title: title || null });
            if (error) throw error;
            setTitle("");
            await load();
            // 바로 진입(선택): nav(`/teacher?room=${data[0].code}&mode=setup`);
        } catch (e:any) { alert(e.message || String(e)); }
    }, [title, load]);

    const enter = (code: string) => nav(`/teacher?room=${code}&mode=setup`);

    const removeRoom = async (id: string) => {
        await supabase.rpc("delete_room_deep", { p_room_id: id }); // id는 uuid
    };


    return (
        <div className="app-shell" style={{ maxWidth: 900 }}>
            <h1>로비</h1>
            <div className="panel" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8 }}>
                    <input className="input" placeholder="방 제목(선택)" value={title} onChange={e=>setTitle(e.target.value)} />
                    <button className="btn" onClick={createRoom}>＋ 방 생성</button>
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
                                    <div style={{ fontSize: 12, opacity: .7 }}>{r.code} · {new Date(r.created_at).toLocaleString()}</div>
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
