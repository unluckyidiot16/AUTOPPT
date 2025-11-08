// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";

type RoomRow = { id: string; current_deck_id: string | null };

export default function DeckEditorPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = useMemo(() => new URLSearchParams(search), [search]);

    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");
    const sourceDeckId = qs.get("src");
    const sourceDeckKey = qs.get("srcKey");

    const [deckId, setDeckId] = useState<string | null>(null);
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, setPreviewPage] = useState<number | null>(1);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [roomIdState, setRoomIdState] = useState<string | null>(null);

    // 🔄 1분 단위 캐시 버스터
    const [cacheVer, setCacheVer] = useState<number>(() => Math.floor(Date.now() / 60000));
    useEffect(() => {
        const t = setInterval(() => setCacheVer(Math.floor(Date.now() / 60000)), 30000);
        return () => clearInterval(t);
    }, []);

    const previewOnce = useRef(false);
    const isClone = Boolean(sourceDeckId);
    const onItemsChange = (next: ManifestItem[]) => setItems(next);

    // DeckEditorPage.tsx
    // DeckEditorPage.tsx
    async function ensureEditingDeckFromFileKey({
                                                    roomCode, fileKey, slot = 1,
                                                }: { roomCode: string; fileKey: string; slot?: number; }) {
        // 0) room 조회
        const { data: room, error: eRoom } = await supabase
            .from("rooms").select("id").eq("code", roomCode).maybeSingle();
        if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
        const roomId = room.id as string;

        // 1) 임시 덱 생성  ✅ is_temp 제거
        const ins = await supabase
            .from("decks")
            .insert({ title: "Untitled (편집)" })
            .select("id")
            .single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

        // 2) 교시 매핑 보장
        await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot });

        // 3) PDF 사본 (버킷 prefix 방어)
        const ts = Date.now();
        const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;
        const srcRel = String(fileKey).replace(/^presentations\//i, "");

        try {
            const cp = await supabase.storage.from("presentations").copy(srcRel, destKey);
            if (cp.error) throw cp.error;
        } catch {
            const dl = await supabase.storage.from("presentations").download(srcRel);
            if (dl.error) throw dl.error;
            const up = await supabase.storage.from("presentations").upload(destKey, dl.data, {
                contentType: "application/pdf",
                upsert: true,
            });
            if (up.error) throw up.error;
        }

        // 4) decks.file_key 갱신 (상대키로 저장)
        await supabase.from("decks").update({ file_key: destKey }).eq("id", newDeckId);

        return { roomId, deckId: newDeckId, file_key: destKey, totalPages: 0 };
    }



    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setErr(null);
            setFileKey(null);

            try {
                if (!roomCode && !deckFromQS && !sourceDeckId) throw new Error("room 또는 deck/src 파라미터가 필요합니다.");

                const { data: roomRow, error: eRoom } = await supabase
                    .from("rooms").select("id,current_deck_id").eq("code", roomCode).maybeSingle<RoomRow>();
                if (eRoom) throw eRoom;
                const roomId = roomRow?.id || null;
                setRoomIdState(roomId);

                if (sourceDeckKey) {
                    const ensured = await ensureEditingDeckFromFileKey({ roomCode, fileKey: sourceDeckKey, slot: 1 });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    setTotalPages(ensured.totalPages || 0);
                } else if (sourceDeckId) {
                    const { data: src, error: eSrc } = await supabase
                        .from("decks").select("file_key, file_pages").eq("id", sourceDeckId).maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");

                    const ensured = await ensureEditingDeckFromFileKey({ roomCode, fileKey: src.file_key, slot: 1 });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    setTotalPages(ensured.totalPages || Number(src.file_pages || 0));
                } else {
                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;
                    if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");
                    if (cancel) return;
                    setDeckId(pickedDeck);

                    const { data: d, error: eDeck } = await supabase.from("decks")
                        .select("file_key,file_pages").eq("id", pickedDeck).maybeSingle();
                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");

                    setFileKey(d.file_key);
                    setTotalPages(Number(d.file_pages || 0));
                }

                try {
                    const m = await getManifestByRoom(roomCode);
                    const arr: ManifestItem[] =
                        Array.isArray(m) ? m :
                            (Array.isArray((m as any)?.items) ? (m as any).items : []);
                    if (!cancel) setItems(arr);
                } catch { /* ignore */ }

            } catch (e: any) {
                if (!cancel) setErr(e?.message || "로드 실패");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, [roomCode, deckFromQS, sourceDeckId, sourceDeckKey]);

    useEffect(() => {
        if (previewOnce.current || loading) return;
        const firstPage =
            (items.find(x => (x as any).type === "page") as any)?.srcPage ??
            (totalPages > 0 ? 1 : 0);
        setPreviewPage(firstPage);
        previewOnce.current = true;
    }, [loading, items, totalPages]);

    const maxPage = Math.max(1, Number(totalPages || 1));
    const dec = () => setPreviewPage(p => Math.max(1, Math.min(maxPage, (p ?? 1) - 1)));
    const inc = () => setPreviewPage(p => Math.max(1, Math.min(maxPage, (p ?? 1) + 1)));

    return (
        <div style={{ padding: 12 }}>
            <div className="topbar" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)}>← 뒤로</button>
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
            ) : !deckId || !fileKey ? (
                <div className="panel" style={{ opacity: 0.6 }}>자료 없음</div>
            ) : (
                // ✅ 2-컬럼: 프리뷰(좌) + 에디터(우)
                <div className="panel" style={{ display: "grid", gridTemplateColumns: "minmax(420px, 48%) 1fr", gap: 16 }}>
                    <div>
                        <EditorPreviewPane fileKey={fileKey} page={previewPage ?? 1} height="calc(100vh - 220px)" version={cacheVer} />
                    </div>
                    <div>
                        <DeckEditor
                            roomCode={roomCode}
                            deckId={deckId}
                            totalPages={totalPages}
                            fileKey={fileKey}
                            onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                            onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                            tempCleanup={isClone && roomIdState ? { roomId: roomIdState, deleteDeckRow: true } : undefined}
                            onItemsChange={onItemsChange}
                            onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
