// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";

type RoomRow = { id: string; current_deck_id: string | null };

async function rpc<T = any>(fn: string, args?: Record<string, any>) {
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) throw error;
    return data as T;
}

function useQS() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

export default function DeckEditorPage() {
    const qs = useQS();
    const nav = useNavigate();

    // /#/editor?room=ROOMCODE (선택: &deck=uuid)
    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");

    const [roomId, setRoomId] = useState<string | null>(null);
    const [deckId, setDeckId] = useState<string | null>(deckFromQS || null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setErr(null);
            try {
                if (!roomCode) throw new Error("room code required");

                // 권한 확보
                try { await rpc("claim_room_auth", { p_code: roomCode }); } catch {}

                // rooms → id, current_deck_id
                const { data: r } = await supabase
                    .from("rooms")
                    .select("id,current_deck_id")
                    .eq("code", roomCode)
                    .maybeSingle<RoomRow>();
                if (!r?.id) throw new Error("room not found");
                if (cancel) return;
                setRoomId(r.id);

                const pickedDeck = deckFromQS ?? r.current_deck_id;
                if (!pickedDeck) {
                    setDeckId(null);
                    setFileUrl(null);
                    setTotalPages(null);
                    setErr("현재 선택된 자료(교시)가 없습니다. 먼저 교사 페이지에서 교시를 선택/불러오세요.");
                    setLoading(false);
                    return;
                }
                setDeckId(pickedDeck);

                // 파일 키 → public URL
                let publicUrl: string | null = null;
                try {
                    const key = await rpc<string | null>("get_current_deck_file_key", { p_code: roomCode });
                    if (key) publicUrl = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                } catch {}
                if (!publicUrl) throw new Error("deck file not found");
                if (cancel) return;

                // 캐시버스터
                try {
                    const u = new URL(publicUrl);
                    u.searchParams.set("t", String(Math.floor(Date.now() / 60000)));
                    publicUrl = u.toString();
                } catch {}

                setFileUrl(publicUrl);

                // 총 페이지
                try {
                    const { data: d } = await supabase
                        .from("decks")
                        .select("file_pages")
                        .eq("id", pickedDeck)
                        .maybeSingle<{ file_pages: number }>();
                    setTotalPages(Number(d?.file_pages) || null);
                } catch { setTotalPages(null); }
            } catch (e: any) {
                setErr(e?.message || "로드 실패");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, [roomCode, deckFromQS]);

    return (
        <div className="app-shell" style={{ maxWidth: 980 }}>
            <div className="topbar" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)}>← 뒤로</button>
                <div style={{ fontWeight: 700 }}>자료 편집</div>
                <span className="badge">room: {roomCode}</span>
                {deckId ? <span className="badge">deck: {deckId.slice(0, 8)}…</span> : <span className="badge">deck: 없음</span>}
            </div>

            {loading ? (
                <div className="panel">불러오는 중…</div>
            ) : err ? (
                <div className="panel" style={{ color: "#f87171" }}>{err}</div>
            ) : !deckId ? (
                <div className="panel">현재 선택된 자료가 없습니다. 교사 페이지에서 교시를 먼저 선택하세요.</div>
            ) : (
                <DeckEditor
                    roomCode={roomCode}
                    deckId={deckId}
                    totalPages={totalPages}
                    fileUrl={fileUrl}
                    onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                    onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                />
            )}
        </div>
    );
}
