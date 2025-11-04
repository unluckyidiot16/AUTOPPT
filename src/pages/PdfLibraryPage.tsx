// src/pages/PdfLibraryPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import { getBasePath } from "../utils/getBasePath";

type DeckRow = {
    id: string;
    ext_id: string | null;
    title: string | null;
    file_key: string | null;
    created_at: string;
};

function useQS() {
    const loc = useLocation();
    return new URLSearchParams(loc.search);
}
const getPublicUrl = (key: string) =>
    supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
async function rpc<T=any>(name: string, params: Record<string, any>) {
    const { data, error } = await supabase.rpc(name, params);
    if (error) { console.error("[RPC ERR]", name, error); throw error; }
    return data as T;
}

export default function PdfLibraryPage() {
    const qs = useQS();
    const nav = useNavigate();
    const roomCode = qs.get("room") ?? "";

    // 검색/정렬/상태
    const [q, setQ] = useState("");
    const [slotSel, setSlotSel] = useState(1);
    const [decks, setDecks] = useState<DeckRow[]>([]);
    const [preview, setPreview] = useState<DeckRow | null>(null);
    const [loading, setLoading] = useState(false);
    const [errMsg, setErrMsg] = useState<string | null>(null);


    // 목록 로드
    const loadDecks = async () => {
        setLoading(true);
        setErrMsg(null);
        // 권한 클레임(이미 클레임된 경우에도 문제 없음)
        try { await rpc("claim_room_auth", { p_code: roomCode }); } catch (e) {}
        const { data, error } = await supabase.rpc("list_decks_by_room_owner", { p_room_code: roomCode });
        if (error) {
            console.error("[list_decks_by_room_owner]", error);
            setDecks([]); // 안전
            setErrMsg("자료함을 불러오지 못했습니다. 로그인/권한을 확인해 주세요.");
        } else {
            setDecks((data as any) ?? []);
        }
        setLoading(false);
    };

    useEffect(() => { if (roomCode) loadDecks(); }, [roomCode]);

    const filt = useMemo(
        () => decks.filter(d => {
            if (!q.trim()) return true;
            const key = `${d.title ?? ""} ${d.ext_id ?? ""}`.toLowerCase();
            return key.includes(q.toLowerCase());
        }),
        [q, decks]
    );

    const assignAndUse = async (d: DeckRow) => {
        if (!roomCode) return;
        await rpc("assign_room_deck_by_id", { p_code: roomCode, p_slot: slotSel, p_deck_id: d.id });
        await rpc("set_room_deck",          { p_code: roomCode, p_slot: slotSel });
        await rpc("goto_slide",             { p_code: roomCode, p_slide: 1, p_step: 0 });
        nav(`/teacher?room=${roomCode}&mode=present`);
    };

    const studentUrl = useMemo(() => {
        const origin = window.location.origin;
        const base = getBasePath();
        return `${origin}${base}/#/student?room=${roomCode}`;
    }, [roomCode]);

    return (
        <div className="app-shell">
            <div className="topbar">
                <h1 style={{ margin: 0 }}>자료함</h1>
                <span className="badge">room: {roomCode || "-"}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 링크</a>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)}>교사 설정</button>
                    <button className="btn btn-primary" onClick={() => nav(`/teacher?room=${roomCode}&mode=present`)}>발표로 이동</button>
                </div>
            </div>

            <div className="panel" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        className="input"
                        placeholder="제목 검색"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        style={{ maxWidth: 360 }}
                    />
                    <button className="btn" onClick={loadDecks} disabled={loading}>{loading ? "새로고침…" : "새로고침"}</button>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, opacity: .75 }}>불러올 슬롯</span>
                        <select className="input" value={slotSel} onChange={(e) => setSlotSel(Number(e.target.value))}>
                            {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}교시</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="panel">
                {errMsg ? (
                    <div style={{ color:"#ef4444" }}>{errMsg}</div>
                ) : filt.length === 0 ? (
                    <div style={{ opacity: 0.6 }}>
                        {loading ? "불러오는 중..." : "업로드된 PDF가 없습니다."}
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                        {filt.map(d => (
                            <div key={d.id} className="card" style={{ padding: 10 }}>
                                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.title ?? d.ext_id}</div>
                                <div style={{ fontSize: 12, opacity: .7, marginBottom: 8 }}>{d.ext_id}</div>
                                {d.file_key && (
                                    <div className="pdf-thumb" style={{ borderRadius: 8, overflow: "hidden", marginBottom: 8, border: "1px solid rgba(148,163,184,.25)" }}>
                                        <div style={{ height: 120, background: "rgba(30,41,59,.35)" }}>
                                            <PdfViewer fileUrl={getPublicUrl(d.file_key)} page={1} />
                                        </div>
                                    </div>
                                )}
                                <div style={{ display:"flex", gap: 8, flexWrap:"wrap" }}>
                                    {d.file_key && <a className="btn" href={getPublicUrl(d.file_key)} target="_blank" rel="noreferrer">링크 열기</a>}
                                    <button className="btn" onClick={() => setPreview(d)}>미리보기</button>
                                    <button className="btn btn-primary" onClick={() => assignAndUse(d)}>
                                        지금 불러오기
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {preview && preview.file_key && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"grid", placeItems:"center", zIndex:70 }}>
                    <div className="panel" style={{ width: 920, maxWidth: "95vw", maxHeight: "90vh", overflow:"auto" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <h3 style={{ margin:0, flex:1 }}>{preview.title ?? preview.ext_id}</h3>
                            <button className="btn" onClick={() => setPreview(null)}>닫기</button>
                        </div>
                        <div className="pdf-stage" style={{ marginTop: 8 }}>
                            <PdfViewer fileUrl={getPublicUrl(preview.file_key)} page={1} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
