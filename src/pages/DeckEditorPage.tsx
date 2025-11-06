// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";

type RoomRow = { id: string; current_deck_id: string | null };

async function rpc<T = any>(fn: string, args?: Record<string, any>) {
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) throw error;
    return data as T;
}
function useQS() { const { search } = useLocation(); return useMemo(() => new URLSearchParams(search), [search]); }

export default function DeckEditorPage() {
    const nav = useNavigate();
    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");

    const [deckId, setDeckId] = useState<string | null>(deckFromQS || null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // 에디터 ↔ 프리뷰 공유 상태
    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, _setPreviewPage] = useState<number | null>(null);
    const previewSetOnceRef = useRef(false); // 최초 확정 플래그
    const applyPatchRef = useRef<null | ((fn: (cur: ManifestItem[]) => ManifestItem[]) => void)>(null);

    const setPreviewPage = (p: number) => {
        _setPreviewPage(prev => (prev === p ? prev : p));
    };

    function publicUrlWithV(key: string, v?: string | number) {
        const url = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
        const token = v ?? Math.floor(Date.now() / 60000); // 분단위 캐시버스트
        return url + (url.includes("?") ? "&" : "?") + "v=" + token;
    }

    const qs = new URLSearchParams(location.search);
    const qsDeckId = qs.get("deck") || undefined;
    const qsRoom   = qs.get("room") || undefined;

    const [filePages, setFilePages] = useState<number | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);

    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoadErr(null);
            setFileUrl(null);
            setFilePages(null);

            try {
                // 1) deck 파라미터가 오면 decks에서 직접 조회 (자료함 → 편집 직행 케이스)
                if (qsDeckId) {
                    const { data: d, error } = await supabase
                        .from("decks")
                        .select("id,file_key,file_pages,updated_at")
                        .eq("id", qsDeckId)
                        .maybeSingle();
                    if (error) throw error;
                    if (!d?.file_key) { setLoadErr("deck file not found"); return; }
                    if (cancel) return;
                    setDeckId(d.id);
                    setFilePages(Number(d.file_pages) || null);
                    setFileUrl(publicUrlWithV(d.file_key, d.updated_at));
                    return;
                }

                // 2) 그 외에는 기존 흐름(방/슬롯 경유) 사용
                //    room의 current_deck_id → decks에서 file_key 조회
                if (!qsRoom) { setLoadErr("room not found"); return; }

                const { data: roomRow } = await supabase
                    .from("rooms")
                    .select("id,current_deck_id")
                    .eq("code", qsRoom)
                    .maybeSingle();

                const currentDeck = roomRow?.current_deck_id ?? null;
                if (!currentDeck) { setLoadErr("deck not selected for room"); return; }

                const { data: d2, error: e2 } = await supabase
                    .from("decks")
                    .select("id,file_key,file_pages,updated_at")
                    .eq("id", currentDeck)
                    .maybeSingle();
                if (e2) throw e2;
                if (!d2?.file_key) { setLoadErr("deck file not found"); return; }
                if (cancel) return;
                setDeckId(d2.id);
                setFilePages(Number(d2.file_pages) || null);
                setFileUrl(publicUrlWithV(d2.file_key, d2.updated_at));
            } catch (e: any) {
                if (!cancel) setLoadErr(e?.message || "load failed");
            }
        })();
        return () => { cancel = true; };
    }, [qsDeckId, qsRoom]);
    

    const attachedQuizzes = useMemo(() => {
        const page = Math.max(0, previewPage ?? 0);
        const qs: ManifestQuizItem[] = [];
        for (let i = 0; i < items.length; i++) {
            const it: any = items[i];
            if (it?.type === "quiz" && (it.attachToSrcPage ?? 0) === page) qs.push(it as ManifestQuizItem);
        }
        return qs;
    }, [items, previewPage]);

    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true); setErr(null);
            try {
                if (!roomCode) throw new Error("room code required");
                try { await rpc("claim_room_auth", { p_code: roomCode }); } catch {}

                const { data: r } = await supabase
                    .from("rooms").select("id,current_deck_id").eq("code", roomCode)
                    .maybeSingle<RoomRow>();
                const pickedDeck = deckFromQS ?? r?.current_deck_id ?? null;
                if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 페이지에서 먼저 선택하세요.");
                if (cancel) return;
                setDeckId(pickedDeck);

                // 파일 URL
                let publicUrl: string | null = null;
                try {
                    const key = await rpc<string | null>("get_current_deck_file_key", { p_code: roomCode });
                    if (key) publicUrl = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                } catch {}
                if (!publicUrl) throw new Error("deck file not found");
                if (cancel) return;
                try { const u = new URL(publicUrl); u.searchParams.set("t", String(Math.floor(Date.now() / 60000))); publicUrl = u.toString(); } catch {}
                setFileUrl(publicUrl);

                // 총 페이지
                try {
                    const { data: d } = await supabase.from("decks").select("file_pages").eq("id", pickedDeck).maybeSingle<{ file_pages: number }>();
                    setTotalPages(Number(d?.file_pages) || 0);
                } catch { setTotalPages(0); }

                // 초기 manifest
                try {
                    const m = await getManifestByRoom(roomCode);
                    if (!cancel) { setItems(m || []); }
                } catch {}
            } catch (e: any) { setErr(e?.message || "로드 실패"); }
            finally { if (!cancel) setLoading(false); }
        })();
        return () => { cancel = true; };
    }, [roomCode, deckFromQS]);

    // 최초 1회 previewPage 확정 (items 또는 totalPages 준비 완료 후)
    useEffect(() => {
        if (previewSetOnceRef.current) return;
        if (loading) return;
        const firstPage = (items.find(x => x.type === "page") as any)?.srcPage;
        setPreviewPage(typeof firstPage === "number" ? firstPage : (totalPages && totalPages > 0 ? 1 : 0));
        previewSetOnceRef.current = true;
    }, [loading, items, totalPages]);

    const maxPage = Math.max(0, Number(totalPages || 0));
    const dec = () => setPreviewPage(Math.max(0, Math.min(maxPage, (previewPage ?? 0) - 1)));
    const inc = () => setPreviewPage(Math.max(0, Math.min(maxPage, (previewPage ?? 0) + 1)));

    return (
        <div style={{ padding: 12 }}>
            <div className="topbar" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)}>← 뒤로</button>
                <div style={{ fontWeight: 700 }}>자료 편집</div>
                <span className="badge">room: {roomCode}</span>
                {deckId ? <span className="badge">deck: {deckId.slice(0, 8)}…</span> : <span className="badge">deck: 없음</span>}
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={dec}>◀ Prev</button>
                    <div className="badge">p.{previewPage ?? 0}</div>
                    <button className="btn" onClick={inc}>Next ▶</button>
                </div>
            </div>

            {loading ? (
                <div className="panel">불러오는 중…</div>
            ) : err ? (
                <div className="panel" style={{ color: "#f87171" }}>{err}</div>
            ) : !deckId ? (
                <div className="panel">현재 선택된 자료가 없습니다. 교사 페이지에서 교시를 먼저 선택하세요.</div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1fr) minmax(520px, 680px)", gap: 12 }}>
                    {/* 좌: 프리뷰(퀴즈 배치 표시 + 드래그 이동) */}
                    <EditorPreviewPane
                        key={`${fileUrl}|prev|p=${previewPage ?? 0}`} // 제어형, 재마운트로 내부상태 고정
                        fileUrl={fileUrl}
                        page={Math.max(0, previewPage ?? 0)}
                        quizzes={attachedQuizzes as any}
                        height="82vh"
                        editable
                        onDragMove={(qIdx, pos) => {
                            // 프리뷰에서 드래그 → 에디터에 반영(DeckEditor 내부 setState 호출)
                            applyPatchRef.current?.((cur) => {
                                const next = cur.slice();
                                let seen = -1;
                                for (let i = 0; i < next.length; i++) {
                                    if ((next[i] as any)?.type === "quiz" && ((next[i] as any).attachToSrcPage ?? 0) === (previewPage ?? 0)) {
                                        seen++;
                                        if (seen === qIdx) {
                                            (next[i] as any).position = "free";
                                            (next[i] as any).posX = pos.x;
                                            (next[i] as any).posY = pos.y;
                                            break;
                                        }
                                    }
                                }
                                return next;
                            });
                        }}
                    />

                    {/* 우: 에디터 */}
                    <DeckEditor
                        roomCode={roomCode}
                        deckId={deckId}
                        totalPages={totalPages}
                        fileUrl={fileUrl}
                        onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                        onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                        onItemsChange={(next) => setItems(next)}
                        onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                        applyPatchRef={applyPatchRef} // 프리뷰 → 에디터로 외부 수정 주입
                    />
                </div>
            )}
        </div>
    );
}
