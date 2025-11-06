// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";

type RoomRow = { id: string; current_deck_id: string | null };

async function getReadablePdfUrlFromKey(key: string): Promise<string> {
    // 서명 URL 우선, 실패 시 public URL
    try {
        const { data, error } = await supabase.storage.from("presentations").createSignedUrl(key, 300);
        if (!error && data?.signedUrl) {
            const u = new URL(data.signedUrl);
            u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
            return u.toString();
        }
    } catch {}
    const raw = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
    const u = new URL(raw);
    u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
    return u.toString();
}

export default function DeckEditorPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = useMemo(() => new URLSearchParams(search), [search]); // ✅ 먼저 선언

    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");

    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, _setPreviewPage] = useState<number | null>(null);
    const previewOnce = useRef(false);

    const [deckId, setDeckId] = useState<string | null>(deckFromQS || null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const setPreviewPage = (p: number) => _setPreviewPage(prev => (prev === p ? prev : p));

    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setErr(null);
            setFileUrl(null);

            try {
                if (!roomCode && !deckFromQS) throw new Error("room 또는 deck 파라미터가 필요합니다.");

                // 1) 자료함 → 편집 직행: deck 파라미터로 decks 직조회
                let pickedDeck = deckFromQS as string | null;
                if (!pickedDeck) {
                    // 2) 교사화면 경유: room.current_deck_id 사용
                    const { data: r } = await supabase
                        .from("rooms")
                        .select("id,current_deck_id")
                        .eq("code", roomCode)
                        .maybeSingle<RoomRow>();
                    pickedDeck = r?.current_deck_id ?? null;
                }
                if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");
                if (cancel) return;

                setDeckId(pickedDeck);

                // ✅ updated_at 없이 file_key, file_pages만 조회
                const { data: d, error: eDeck } = await supabase
                    .from("decks")
                    .select("file_key,file_pages")
                    .eq("id", pickedDeck)
                    .maybeSingle();
                if (eDeck) throw eDeck;
                if (!d?.file_key) throw new Error("deck file not found");

                const url = await getReadablePdfUrlFromKey(d.file_key);
                if (cancel) return;

                setFileUrl(url);
                setTotalPages(Number(d.file_pages || 0));

                // 초기 manifest
                try {
                    const m = await getManifestByRoom(roomCode);
                    if (!cancel) setItems(m || []);
                } catch {}
            } catch (e: any) {
                if (!cancel) setErr(e?.message || "로드 실패");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, [roomCode, deckFromQS]);

    // 최초 1회 미리보기 페이지 지정
    useEffect(() => {
        if (previewOnce.current || loading) return;
        const firstPage =
            (items.find(x => (x as any).type === "page") as any)?.srcPage ??
            (totalPages > 0 ? 1 : 0);
        setPreviewPage(firstPage);
        previewOnce.current = true;
    }, [loading, items, totalPages]);

    const maxPage = Math.max(0, Number(totalPages || 0));
    const dec = () => setPreviewPage(Math.max(0, Math.min(maxPage, (previewPage ?? 0) - 1)));
    const inc = () => setPreviewPage(Math.max(0, Math.min(maxPage, (previewPage ?? 0) + 1)));

    return (
        <div style={{ padding: 12 }}>
            <div className="topbar" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <button className="btn" onClick={() => roomCode ? nav(`/teacher?room=${roomCode}&mode=setup`) : nav(`/teacher`)}>← 뒤로</button>
                <div style={{ fontWeight: 700 }}>자료 편집</div>
                {roomCode && <span className="badge">room: {roomCode}</span>}
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
            ) : !deckId || !fileUrl ? (
                <div className="panel">현재 선택된 자료가 없습니다. 교사 화면에서 교시를 먼저 선택하세요.</div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1fr) minmax(520px, 680px)", gap: 12 }}>
                    <EditorPreviewPane
                        key={`${fileUrl}|prev|p=${previewPage ?? 0}`}
                        fileUrl={fileUrl}
                        page={Math.max(0, previewPage ?? 0)}
                        height="82vh"
                    />
                    <DeckEditor
                        roomCode={roomCode}
                        deckId={deckId}
                        totalPages={totalPages}
                        fileUrl={fileUrl}
                        onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                        onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                        onItemsChange={(next) => setItems(next)}
                        onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                    />
                </div>
            )}
        </div>
    );
}
