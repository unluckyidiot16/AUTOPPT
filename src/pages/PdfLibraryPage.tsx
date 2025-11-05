// src/pages/PdfLibraryPage.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
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

async function rpc<T = any>(name: string, params?: Record<string, any>) {
    const { data, error } = await supabase.rpc(name, params ?? {});
    if (error) {
        console.error("[RPC ERR]", name, error);
        throw error;
    }
    return data as T;
}

/** 미리보기 모달 */
function PreviewModal({
                          preview,
                          onClose,
                      }: {
    preview: DeckRow;
    onClose: () => void;
}) {
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const fileUrl = preview.file_key ? getPublicUrl(preview.file_key) : "";

    useEffect(() => {
        let cancel = false;
        (async () => {
            try {
                const { data, error } = await supabase
                    .from("decks")
                    .select("file_pages")
                    .eq("id", preview.id)
                    .maybeSingle();
                if (error) throw error;
                if (!cancel) setTotalPages(Number(data?.file_pages) || null);
            } catch {
                if (!cancel) setTotalPages(null);
            }
        })();
        return () => { cancel = true; };
    }, [preview.id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") setCurrentPage((p) => Math.max(1, p - 1));
            else if (e.key === "ArrowRight") setCurrentPage((p) => (totalPages ? Math.min(totalPages, p + 1) : p + 1));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, totalPages]);

    const canPrev = currentPage > 1;
    const canNext = totalPages ? currentPage < totalPages : true;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 70 }}
             role="dialog" aria-modal="true" aria-label="PDF 미리보기">
            <div className="panel" style={{ width: "min(92vw, 920px)", maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{preview.title ?? preview.ext_id}</h3>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button className="btn" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={!canPrev}>이전</button>
                        <span style={{ fontSize: 14, minWidth: 80, textAlign: "center" }}>
              페이지 {currentPage}{totalPages ? `/${totalPages}` : ""}
            </span>
                        <button className="btn" onClick={() => setCurrentPage((p) => (canNext ? p + 1 : p))} disabled={!canNext}>다음</button>
                        <button className="btn" onClick={onClose}>닫기</button>
                    </div>
                </div>
                <div className="pdf-stage" style={{ flex: 1, overflow: "auto", borderRadius: 8, background: "#f3f4f6" }}>
                    {fileUrl ? (
                        <PdfViewer fileUrl={fileUrl} page={currentPage} maxHeight="calc(90vh - 120px)" />
                    ) : (
                        <div style={{ padding: 16, textAlign: "center", opacity: 0.6 }}>파일이 없습니다.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function PdfLibraryPage() {
    const qs = useQS();
    const nav = useNavigate();
    const roomCode = qs.get("room") ?? "";

    const [q, setQ] = useState("");
    const [slotSel, setSlotSel] = useState(1);
    const [decks, setDecks] = useState<DeckRow[]>([]);
    const [preview, setPreview] = useState<DeckRow | null>(null);
    const [loading, setLoading] = useState(false);
    const [errMsg, setErrMsg] = useState<string | null>(null);

    const loadDecks = useCallback(async () => {
        setLoading(true);
        setErrMsg(null);
        try {
            try { await rpc("claim_room_auth", { p_code: roomCode }); } catch {}
            const { data, error } = await supabase.rpc("list_decks_by_room_owner", { p_room_code: roomCode });
            if (error) throw error;
            setDecks((data as any) ?? []);
        } catch (e) {
            console.error("[list_decks_by_room_owner]", e);
            setDecks([]);
            setErrMsg("자료함을 불러오지 못했습니다. 로그인/권한을 확인해 주세요.");
        } finally {
            setLoading(false);
        }
    }, [roomCode]);

    useEffect(() => { if (roomCode) loadDecks(); }, [roomCode, loadDecks]);

    const filt = useMemo(
        () => decks.filter((d) => {
            if (!q.trim()) return true;
            const key = `${d.title ?? ""} ${d.ext_id ?? ""}`.toLowerCase();
            return key.includes(q.toLowerCase());
        }),
        [q, decks]
    );

    const assignAndUse = async (d: DeckRow) => {
        if (!roomCode) return;
        try {
            await rpc("claim_room_auth", { p_code: roomCode });
            await rpc("assign_room_deck_by_id", { p_code: roomCode, p_slot: slotSel, p_deck_id: d.id });
            await rpc("set_room_deck", { p_code: roomCode, p_slot: slotSel });

            // 슬롯 페이지 초기화(있으면 사용)
            try {
                await rpc("set_current_page_for_slot", { p_code: roomCode, p_slot: slotSel, p_page: 1 });
            } catch {}

            // 페이지 이동: goto_page → goto_slide 폴백
            let pageSetOk = false;
            try {
                await rpc("goto_page", { p_code: roomCode, p_page: 1 });
                pageSetOk = true;
            } catch (e1) {
                console.warn("goto_page failed, fallback to goto_slide", e1);
                try {
                    await rpc("goto_slide", { p_code: roomCode, p_slide: 1, p_step: 0 });
                    pageSetOk = true;
                } catch (e2) {
                    console.error("goto_slide fallback failed", e2);
                }
            }

            // 실패해도 수업은 진행: 발표 화면으로 전환
            if (!pageSetOk) {
                alert("서버에 페이지 반영은 실패했지만, 발표 화면으로 이동합니다. (임시 동기화)");
            }
            nav(`/teacher?room=${roomCode}&mode=present`);
        } catch (error) {
            console.error("[assignAndUse] Error:", error);
            alert("자료를 불러오는 중 오류가 발생했습니다.");
        }
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
                    <input className="input" placeholder="제목 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
                    <button className="btn" onClick={loadDecks} disabled={loading}>{loading ? "새로고침…" : "새로고침"}</button>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, opacity: 0.75 }}>불러올 슬롯</span>
                        <select className="input" value={slotSel} onChange={(e) => setSlotSel(Number(e.target.value))}>
                            {[1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n}교시</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="panel">
                {errMsg ? (
                    <div style={{ color: "#ef4444" }}>{errMsg}</div>
                ) : filt.length === 0 ? (
                    <div style={{ opacity: 0.6 }}>{loading ? "불러오는 중..." : "업로드된 PDF가 없습니다."}</div>
                ) : (
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                        {filt.map((d) => (
                            <div key={d.id} className="card" style={{ padding: 10 }}>
                                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.title ?? d.ext_id}</div>
                                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{d.ext_id}</div>
                                {d.file_key ? (
                                    <div className="pdf-thumb" style={{ borderRadius: 8, overflow: "hidden", marginBottom: 8, border: "1px solid rgba(148,163,184,.25)", height: 120, position: "relative" }} aria-label="PDF 썸네일">
                                        <PdfViewer fileUrl={getPublicUrl(d.file_key)} page={1} maxHeight="120px" />
                                    </div>
                                ) : (
                                    <div style={{ height: 120, marginBottom: 8, borderRadius: 8, display: "grid", placeItems: "center", border: "1px dashed rgba(148,163,184,.35)", color: "#94a3b8", fontSize: 12 }}>
                                        파일 없음
                                    </div>
                                )}
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {d.file_key && <a className="btn" href={getPublicUrl(d.file_key)} target="_blank" rel="noreferrer">링크 열기</a>}
                                    {d.file_key && <button className="btn" onClick={() => setPreview(d)}>미리보기</button>}
                                    <button className="btn btn-primary" onClick={() => assignAndUse(d)}>지금 불러오기</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {preview && preview.file_key && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
        </div>
    );
}
