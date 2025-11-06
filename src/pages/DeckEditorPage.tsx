// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";
import { getPdfUrlFromKey } from "../utils/supaFiles";


const TEMPLATE_KEY = "_templates/blank-1p.pdf"; // presentations 버킷에 미리 올려둔 1p 빈 PDF
const TEMPLATE_PAGES = 1;                        // 템플릿 페이지 수

type RoomRow = { id: string; current_deck_id: string | null };

// 임시 PDF를 현재 덱에 붙이고 decks.file_key/ file_pages를 채운다.
// - 기본은 "현재 덱 id 재사용" 모드(reuse). 새 덱을 만들고 배정하고 싶으면 아래 NEW 모드 참고.
async function provisionTempDeckFile({
                                         roomId,
                                         deckId,
                                         templateKey = "_templates/blank-1p.pdf",
                                         pages = 1,
                                     }: {
    roomId: string;           // 현재 편집 중인 room_id
    deckId: string;           // 현재 편집 중인 deck_id (파일만 붙임)
    templateKey?: string;     // presentations 버킷 내 템플릿 경로
    pages?: number;           // 템플릿 페이지 수
}) {
    // 1) 목적지 키 만들기
    const ts = Date.now();
    const destKey = `rooms/${roomId}/decks/${deckId}/slides-${ts}.pdf`;

    // 2) 템플릿 → 목적지로 복사 (SDK v2는 copy 지원, 환경에 따라 download→upload로 폴백)
    let copyOk = false;
    try {
        const { data, error } = await supabase.storage
            .from("presentations")
            .copy(templateKey, destKey); // ← 가능하면 이게 제일 깔끔
        if (!error) copyOk = true;
    } catch {/* noop */}

    if (!copyOk) {
        // 폴백: 다운로드 후 업로드
        const dl = await supabase.storage.from("presentations").download(templateKey);
        if (dl.error) throw dl.error;
        const up = await supabase.storage
            .from("presentations")
            .upload(destKey, dl.data, { contentType: "application/pdf", upsert: true });
        if (up.error) throw up.error;
    }

    // 3) decks 테이블에 file_key / file_pages 갱신
    const upDeck = await supabase
        .from("decks")
        .update({ file_key: destKey, file_pages: pages })
        .eq("id", deckId)
        .select("id, file_key, file_pages")
        .single();
    if (upDeck.error) throw upDeck.error;

    return { file_key: destKey, file_pages: pages };
}


export default function DeckEditorPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = useMemo(() => new URLSearchParams(search), [search]); // ✅ 먼저 선언

    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");
    const sourceDeckId = qs.get("src");

    const srcKey = qs.get("srcKey");

    const [deckId, setDeckId] = useState<string | null>(deckFromQS);

    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, _setPreviewPage] = useState<number | null>(null);
    const previewOnce = useRef(false);

    const [roomIdState, setRoomIdState] = useState<string | null>(null);
    const isClone = !!sourceDeckId;    
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
                if (srcKey) { setLoading(false); return; }
                if (!roomCode && !deckFromQS && !sourceDeckId) throw new Error("room 또는 deck/src 파라미터가 필요합니다.");

                // room 조회
                const { data: roomRow, error: eRoom } = await supabase
                    .from("rooms").select("id,current_deck_id")
                    .eq("code", roomCode).maybeSingle<RoomRow>();
                if (eRoom) throw eRoom;
                const roomId = roomRow?.id || null;
                setRoomIdState(roomId);

                if (sourceDeckId) {
                    // 1) 라이브러리 → 편집: 원본 덱의 file_key 조회 → 파일키 기반 복제
                    const { data: src, error: eSrc } = await supabase
                        .from("decks")
                        .select("file_key, file_pages")
                        .eq("id", sourceDeckId)
                        .maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");
                    
                    const ensured = await ensureEditingDeckFromFileKey({ roomCode, fileKey: src.file_key, slot: 1 });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileUrl(ensured.signedUrl);
                    setTotalPages(ensured.totalPages || Number(src.file_pages || 0));
                } else {
                    // 2) 기존: deck 직접 열기
                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;
                    if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");
                    if (cancel) return;
                    setDeckId(pickedDeck);

                    const { data: d, error: eDeck } = await supabase.from("decks")
                        .select("file_key,file_pages").eq("id", pickedDeck).maybeSingle();
                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");

                    const url = await getPdfUrlFromKey(d.file_key, { ttlSec: 1800 });
                    if (cancel) return;
                    setFileUrl(url);
                    setTotalPages(Number(d.file_pages || 0));
                }

                // manifest는 공통 로드(실패 무시)
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
    }, [roomCode, deckFromQS, sourceDeckId, srcKey]);


    // ✅ srcKey로 들어온 경우: 파일키 기반 복제 편집 플로우
    useEffect(() => {
        if (!srcKey) return;
        let cancel = false;

        (async () => {
            setLoading(true);
            setErr(null);
            try {
                const ensured = await ensureEditingDeckFromFileKey({ roomCode, fileKey: srcKey, slot: 1 });
                if (cancel) return;
                setDeckId(ensured.deckId);
                setFileUrl(ensured.signedUrl);
                setTotalPages(ensured.totalPages);
                setRoomIdState(ensured.roomId);

                // manifest 로드 (실패 무시)
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
    }, [srcKey, roomCode]);


    async function ensureEditingDeckFromFileKey({ roomCode, fileKey, slot = 1 }:{
        roomCode: string; fileKey: string; slot?: number;
    }) {
        const { data: room, error: eRoom } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
        const roomId = room.id as string;

        const ins = await supabase.from("decks").insert({ title: "Untitled (편집)", is_temp: true }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

        await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot });

        const ts = Date.now();
        const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;

        // copy → download/upload 폴백
        let copied = false;
        try { const { error } = await supabase.storage.from("presentations").copy(fileKey, destKey); if (!error) copied = true; } catch {}
        if (!copied) {
            const dl = await supabase.storage.from("presentations").download(fileKey);
            if (dl.error) throw dl.error;
            const up = await supabase.storage.from("presentations").upload(destKey, dl.data, {
                contentType: "application/pdf", upsert: true,
            });
            if (up.error) throw up.error;
        }

        await supabase.from("decks").update({ file_key: destKey }).eq("id", newDeckId);

        const { data: sdata, error: serr } = await supabase.storage.from("presentations").createSignedUrl(destKey, 1800);
        if (serr || !sdata?.signedUrl) throw serr ?? new Error("signed url 실패");
        const u = new URL(sdata.signedUrl); u.hash = `v=${Math.floor(Date.now()/60000)}`;

        return { roomId, deckId: newDeckId, signedUrl: u.toString(), totalPages: 0 };
    }


    // 최초 1회 미리보기 페이지 지정
    useEffect(() => {
        if (previewOnce.current || loading) return;
        const firstPage =
            (items.find(x => (x as any).type === "page") as any)?.srcPage ??
            (totalPages > 0 ? 1 : 0);
        setPreviewPage(firstPage);
        previewOnce.current = true;
    }, [loading, items, totalPages]);

    const maxPage = Math.max(1, Number(totalPages || 1));
    const dec = () => setPreviewPage(Math.max(1, Math.min(maxPage, (previewPage ?? 1) - 1)));
    const inc = () => setPreviewPage(Math.max(1, Math.min(maxPage, (previewPage ?? 1) + 1)));

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
                        page={Math.max(1, previewPage ?? 1)}
                        height="82vh"
                    />
                    <DeckEditor
                        roomCode={roomCode}
                        deckId={deckId}
                        totalPages={totalPages}
                        fileUrl={fileUrl}
                        onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                        onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)} 
                        tempCleanup={isClone && roomIdState ? { roomId: roomIdState, deleteDeckRow: true } : undefined}
                        onItemsChange={(next) => setItems(next)}
                        onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                    />
                </div>
            )}
        </div>
    );
}
