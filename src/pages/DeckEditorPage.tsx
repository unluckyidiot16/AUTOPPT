// src/pages/DeckEditorPage.tsx - Fixed Version
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";
import { getPdfUrlFromKey } from "../utils/supaFiles";

const TEMPLATE_KEY = "_templates/blank-1p.pdf";
const TEMPLATE_PAGES = 1;

type RoomRow = { id: string; current_deck_id: string | null };

// PDF 페이지 수를 가져오는 헬퍼 함수 추가
async function getPdfPageCount(fileKey: string): Promise<number> {
    try {
        // 원본 파일의 정보를 찾기 위해 decks 테이블에서 검색
        const { data: existingDeck } = await supabase
            .from("decks")
            .select("file_pages")
            .eq("file_key", fileKey)
            .maybeSingle();

        if (existingDeck?.file_pages) {
            return existingDeck.file_pages;
        }

        // 기본값 반환 (실제 PDF 처리 라이브러리가 있다면 여기서 실제 페이지 수 계산)
        // PDF.js를 사용하여 실제 페이지 수를 가져올 수도 있음
        return 10; // 기본값 - 실제 구현시 PDF 파싱 필요
    } catch (error) {
        console.warn("Could not get PDF page count:", error);
        return 10; // 기본값
    }
}

async function provisionTempDeckFile({
                                         roomId,
                                         deckId,
                                         templateKey = "_templates/blank-1p.pdf",
                                         pages = 1,
                                     }: {
    roomId: string;
    deckId: string;
    templateKey?: string;
    pages?: number;
}) {
    const ts = Date.now();
    const destKey = `rooms/${roomId}/decks/${deckId}/slides-${ts}.pdf`;

    let copyOk = false;
    try {
        const { data, error } = await supabase.storage
            .from("presentations")
            .copy(templateKey, destKey);
        if (!error) copyOk = true;
    } catch {/* noop */}

    if (!copyOk) {
        const dl = await supabase.storage.from("presentations").download(templateKey);
        if (dl.error) throw dl.error;
        const up = await supabase.storage
            .from("presentations")
            .upload(destKey, dl.data, { contentType: "application/pdf", upsert: true });
        if (up.error) throw up.error;
    }

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
    const qs = useMemo(() => new URLSearchParams(search), [search]);

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

    // 개선된 ensureEditingDeckFromFileKey 함수
    async function ensureEditingDeckFromFileKey({
                                                    roomCode,
                                                    fileKey,
                                                    slot = 1,
                                                    sourcePageCount
                                                }: {
        roomCode: string;
        fileKey: string;
        slot?: number;
        sourcePageCount?: number;
    }) {
        const { data: room, error: eRoom } = await supabase
            .from("rooms")
            .select("id")
            .eq("code", roomCode)
            .maybeSingle();

        if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
        const roomId = room.id as string;

        // 원본 파일의 페이지 수 가져오기
        let pageCount = sourcePageCount;
        if (!pageCount) {
            pageCount = await getPdfPageCount(fileKey);
        }

        // 새 덱 생성
        const ins = await supabase
            .from("decks")
            .insert({
                title: "Untitled (편집)",
                is_temp: true,
                file_pages: pageCount // 페이지 수 초기 설정
            })
            .select("id")
            .single();

        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

        // Room에 덱 할당
        await supabase.from("room_decks").upsert({
            room_id: roomId,
            deck_id: newDeckId,
            slot
        });

        const ts = Date.now();
        const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;

        // 파일 복사
        let copied = false;
        try {
            const { error } = await supabase.storage
                .from("presentations")
                .copy(fileKey, destKey);
            if (!error) copied = true;
        } catch {}

        if (!copied) {
            const dl = await supabase.storage.from("presentations").download(fileKey);
            if (dl.error) throw dl.error;
            const up = await supabase.storage.from("presentations").upload(destKey, dl.data, {
                contentType: "application/pdf",
                upsert: true,
            });
            if (up.error) throw up.error;
        }

        // file_key와 file_pages 업데이트
        await supabase
            .from("decks")
            .update({
                file_key: destKey,
                file_pages: pageCount // 페이지 수 업데이트
            })
            .eq("id", newDeckId);

        // 서명된 URL 생성
        const { data: sdata, error: serr } = await supabase.storage
            .from("presentations")
            .createSignedUrl(destKey, 1800);

        if (serr || !sdata?.signedUrl) throw serr ?? new Error("signed url 실패");

        const u = new URL(sdata.signedUrl);
        u.hash = `v=${Math.floor(Date.now()/60000)}`;

        return {
            roomId,
            deckId: newDeckId,
            signedUrl: u.toString(),
            totalPages: pageCount // 실제 페이지 수 반환
        };
    }

    // 메인 로직 - 통합된 useEffect
    useEffect(() => {
        let cancel = false;

        (async () => {
            setLoading(true);
            setErr(null);
            setFileUrl(null);

            try {
                // srcKey로 들어온 경우 처리
                if (srcKey) {
                    const ensured = await ensureEditingDeckFromFileKey({
                        roomCode,
                        fileKey: srcKey,
                        slot: 1
                    });

                    if (cancel) return;

                    setDeckId(ensured.deckId);
                    setFileUrl(ensured.signedUrl);
                    setTotalPages(ensured.totalPages);
                    setRoomIdState(ensured.roomId);
                }
                // sourceDeckId로 들어온 경우 처리
                else if (sourceDeckId) {
                    // room 조회
                    const { data: roomRow, error: eRoom } = await supabase
                        .from("rooms")
                        .select("id,current_deck_id")
                        .eq("code", roomCode)
                        .maybeSingle<RoomRow>();

                    if (eRoom) throw eRoom;
                    const roomId = roomRow?.id || null;
                    setRoomIdState(roomId);

                    // 원본 덱의 file_key 조회
                    const { data: src, error: eSrc } = await supabase
                        .from("decks")
                        .select("file_key, file_pages")
                        .eq("id", sourceDeckId)
                        .maybeSingle();

                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");

                    const ensured = await ensureEditingDeckFromFileKey({
                        roomCode,
                        fileKey: src.file_key,
                        slot: 1,
                        sourcePageCount: src.file_pages || undefined
                    });

                    if (cancel) return;

                    setDeckId(ensured.deckId);
                    setFileUrl(ensured.signedUrl);
                    setTotalPages(ensured.totalPages || Number(src.file_pages || 10));
                }
                // 기존 deck 직접 열기
                else {
                    if (!roomCode && !deckFromQS) {
                        throw new Error("room 또는 deck 파라미터가 필요합니다.");
                    }

                    // room 조회
                    const { data: roomRow, error: eRoom } = await supabase
                        .from("rooms")
                        .select("id,current_deck_id")
                        .eq("code", roomCode)
                        .maybeSingle<RoomRow>();

                    if (eRoom) throw eRoom;
                    const roomId = roomRow?.id || null;
                    setRoomIdState(roomId);

                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;

                    if (!pickedDeck) {
                        throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");
                    }

                    if (cancel) return;
                    setDeckId(pickedDeck);

                    const { data: d, error: eDeck } = await supabase
                        .from("decks")
                        .select("file_key,file_pages")
                        .eq("id", pickedDeck)
                        .maybeSingle();

                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");

                    const url = await getPdfUrlFromKey(d.file_key, { ttlSec: 1800 });

                    if (cancel) return;

                    setFileUrl(url);
                    setTotalPages(Number(d.file_pages || 10));
                }

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
    }, [roomCode, deckFromQS, sourceDeckId, srcKey]);

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
            <div className="topbar" style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12
            }}>
                <button
                    className="btn"
                    onClick={() => roomCode ? nav(`/teacher?room=${roomCode}&mode=setup`) : nav(`/teacher`)}
                >
                    ← 뒤로
                </button>
                <div style={{ fontWeight: 700 }}>자료 편집</div>
                {roomCode && <span className="badge">room: {roomCode}</span>}
                {deckId ? (
                    <span className="badge">deck: {deckId.slice(0, 8)}…</span>
                ) : (
                    <span className="badge">deck: 없음</span>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={dec}>◀ Prev</button>
                    <div className="badge">p.{previewPage ?? 0} / {totalPages}</div>
                    <button className="btn" onClick={inc}>Next ▶</button>
                </div>
            </div>

            {loading ? (
                <div className="panel">불러오는 중…</div>
            ) : err ? (
                <div className="panel" style={{ color: "#f87171" }}>
                    오류: {err}
                </div>
            ) : !deckId || !fileUrl ? (
                <div className="panel">
                    현재 선택된 자료가 없습니다. 교사 화면에서 교시를 먼저 선택하세요.
                </div>
            ) : (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(420px, 1fr) minmax(520px, 680px)",
                    gap: 12
                }}>
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
                        tempCleanup={isClone && roomIdState ? {
                            roomId: roomIdState,
                            deleteDeckRow: true
                        } : undefined}
                        onItemsChange={(next) => setItems(next)}
                        onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                    />
                </div>
            )}
        </div>
    );
}
