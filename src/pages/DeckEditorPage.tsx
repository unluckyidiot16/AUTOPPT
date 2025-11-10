// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import EditorThumbnailStrip from "../components/EditorThumbnailStrip";
import type { ManifestItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";
import { slidesPrefixOfPresentationsFile } from "../utils/supaFiles";
import type { Overlay } from "../components/SlideStage";

type RoomRow = { id: string; current_deck_id: string | null };

function withSlash(p: string) { return p.endsWith("/") ? p : `${p}/`; }

/* ─ storage helpers (생략 없음) ─ */
async function countWebps(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return 0;
    return (data ?? []).filter((f) => /\.webp$/i.test(f.name)).length;
}
async function listFlat(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return [];
    return data ?? [];
}
async function copyObjectInBucket(bucket: string, from: string, to: string, contentType?: string) {
    try {
        const { error } = await supabase.storage.from(bucket).copy(from, to);
        if (!error) return;
    } catch {}
    const dl = await supabase.storage.from(bucket).download(from);
    if (dl.error) throw dl.error;
    const up = await supabase.storage.from(bucket).upload(to, dl.data, { upsert: true, contentType });
    if (up.error) throw up.error;
}
async function copyDirSameBucket(bucket: string, fromPrefix: string, toPrefix: string, onlyExt: RegExp) {
    if (await countWebps(bucket, toPrefix) > 0) return;
    const src = await listFlat(bucket, fromPrefix);
    for (const f of src) {
        if (!onlyExt.test(f.name)) continue;
        await copyObjectInBucket(bucket, `${withSlash(fromPrefix)}${f.name}`, `${withSlash(toPrefix)}${f.name}`);
    }
}
async function copyDirCrossBuckets(
    fromBucket: "presentations" | "slides",
    toBucket: "slides",
    fromPrefix: string,
    toPrefix: string,
    onlyExt: RegExp
) {
    if (await countWebps(toBucket, toPrefix) > 0) return;
    const src = await listFlat(fromBucket, fromPrefix);
    for (const f of src) {
        if (!onlyExt.test(f.name)) continue;
        const dl = await supabase.storage.from(fromBucket).download(`${withSlash(fromPrefix)}${f.name}`);
        if (dl.error) throw dl.error;
        const up = await supabase.storage.from(toBucket).upload(`${withSlash(toPrefix)}${f.name}`, dl.data, {
            upsert: true,
            contentType: "image/webp",
        });
        if (up.error) throw up.error;
    }
}

async function getActualSlidesCountByFileKey(fileKey: string): Promise<number> {
    const prefix =
        slidesPrefixOfPresentationsFile(fileKey) ??
        slidesPrefixOfPresentationsFile(String(fileKey).replace(/^presentations\//i, "")) ??
        null;
    if (!prefix) return 0;
    return await countWebps("slides", prefix).catch(() => 0);
}


/** 편집용 덱 생성: PDF 사본 + 기존 WEBP 복사(재변환 없음) */
async function ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey }: { roomCode: string; fileKey: string }) {
    const { data: room, error: eRoom } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
    if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
    const roomId = room.id as string;

    const ins = await supabase.from("decks").insert({ title: "Untitled (편집)" }).select("id").single();
    if (ins.error) throw ins.error;
    const deckId = ins.data.id as string;

    const ts = Date.now();
    const destPdfKey = `rooms/${roomId}/decks/${deckId}/slides-${ts}.pdf`;
    const srcRel = String(fileKey).replace(/^presentations\//i, "");
    await copyObjectInBucket("presentations", srcRel, destPdfKey, "application/pdf");

    const srcPrefix = slidesPrefixOfPresentationsFile(fileKey) ?? slidesPrefixOfPresentationsFile(srcRel) ?? null;
    const dstPrefix = `rooms/${roomId}/decks/${deckId}`;

    if (srcPrefix) {
        const srcSlides = await countWebps("slides", srcPrefix).catch(() => 0);
        if (srcSlides > 0) {
            await copyDirSameBucket("slides", srcPrefix, dstPrefix, /\.webp$/i);
        } else {
            const legacy = await countWebps("presentations", srcPrefix).catch(() => 0);
            if (legacy > 0) await copyDirCrossBuckets("presentations", "slides", srcPrefix, dstPrefix, /\.webp$/i);
        }
    }

    const pages = await countWebps("slides", dstPrefix).catch(() => 0);
    await supabase.from("decks").update({ file_key: destPdfKey, file_pages: pages || null }).eq("id", deckId);
    return { roomId, deckId, file_key: destPdfKey, totalPages: pages };
}

/* ───────────────────────────── DeckEditorPage ───────────────────────────── */
export default function DeckEditorPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = useMemo(() => new URLSearchParams(search), [search]);

    const roomCode = qs.get("room") || "";
    const deckFromQS = qs.get("deck");
    const sourceDeckId = qs.get("src");
    const sourceDeckKey = qs.get("srcKey");

    const [zoom, setZoom] = useState<0.5 | 0.75 | 1 | 1.25 | 1.5>(1);
    const [aspectMode, setAspectMode] =
        useState<"auto" | "16:9" | "16:10" | "4:3" | "3:2" | "A4">("16:9");

    // 썸네일 토글: bottom | left
    const [thumbPos, setThumbPos] = useState<"bottom" | "left">("bottom");
    const leftBarWidth = 164;

    const applyPatchRef = useRef<((fn: (cur: ManifestItem[]) => ManifestItem[]) => void) | null>(null);

    const [deckId, setDeckId] = useState<string | null>(null);
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);

    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, setPreviewPage] = useState<number | null>(1);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const previewCol = "minmax(560px, 1.1fr)";   // 프리뷰: 최소 560px
    const editorCol  = "minmax(420px, 0.9fr)";   // 편집기: 최소 420px
    
    
    const [cacheVer, setCacheVer] = useState<number>(() => Math.floor(Date.now() / 60000));
    useEffect(() => {
        const t = setInterval(() => setCacheVer(Math.floor(Date.now() / 60000)), 30000);
        return () => clearInterval(t);
    }, []);

    const onItemsChange = (next: ManifestItem[]) => setItems(next);

    const maxPageFromItems = (list: ManifestItem[]) =>
        list.filter((it: any) => it?.type === "page").length;

    // 초기 로드
    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setErr(null);
            setFileKey(null);
            try {
                if (!roomCode && !deckFromQS && !sourceDeckId) throw new Error("room 또는 deck/src 파라미터가 필요합니다.");

                if (sourceDeckKey) {
                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: sourceDeckKey });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    {
                           let pages = ensured.totalPages || 0;
                           if (!pages) pages = await getActualSlidesCountByFileKey(ensured.file_key);
                           setTotalPages(pages);
                           if (pages > 0) setCacheVer(v => v + 1);
                         }
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else if (sourceDeckId) {
                    const { data: src, error: eSrc } = await supabase
                        .from("decks").select("file_key, file_pages").eq("id", sourceDeckId).maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");
                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: src.file_key });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    {
                           let pages = ensured.totalPages || Number(src.file_pages || 0);
                           if (!pages) pages = await getActualSlidesCountByFileKey(ensured.file_key);
                           setTotalPages(pages);
                           if (pages > 0) setCacheVer(v => v + 1);
                         }
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else {
                    const { data: roomRow, error: eRoom } = await supabase
                        .from("rooms").select("id,current_deck_id").eq("code", roomCode).maybeSingle<RoomRow>();
                    if (eRoom) throw eRoom;
                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;
                    if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");

                    setDeckId(pickedDeck);
                    const { data: d, error: eDeck } = await supabase
                        .from("decks").select("file_key,file_pages").eq("id", pickedDeck).maybeSingle();
                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");
                    setFileKey(d.file_key);
                     {
                       let pages = Number(d.file_pages || 0);
                       if (!pages) {
                            pages = await getActualSlidesCountByFileKey(d.file_key);
                             if (pages > 0) {
                                   // DB도 최신화(선택 사항)
                                       await supabase.from("decks").update({ file_pages: pages }).eq("id", pickedDeck);
                                 }
                           }
                       setTotalPages(pages);
                     }
                }

                try {
                    const m = await getManifestByRoom(roomCode);
                    const arr: ManifestItem[] = Array.isArray(m) ? m : Array.isArray((m as any)?.items) ? (m as any).items : [];
                    if (!cancel) setItems(arr);
                } catch {}
            } catch (e: any) {
                if (!cancel) setErr(e?.message || "로드 실패");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, [roomCode, deckFromQS, sourceDeckId, sourceDeckKey]);

    // 프리뷰 초기 페이지
    useEffect(() => {
        if (loading) return;
        const hasMetaPages = maxPageFromItems(items) > 0;
        setPreviewPage(hasMetaPages || totalPages > 0 ? 1 : 0);
    }, [loading, items, totalPages]);

    // 프리뷰 계산
    const previewBgPage = useMemo(() => Number(previewPage || 0), [previewPage]);

    const overlaysForPreview: Overlay[] = useMemo(() => {
        const p = Number(previewPage ?? 0);
        if (!p || !Array.isArray(items)) return [];
        return items
            .filter((it: any) => (it?.type === "quiz" || it?.kind === "quiz") && Number((it as any)?.srcPage ?? (it as any)?.page) === p)
            .map((q: any, idx: number) => ({
                id: String(q.id ?? `quiz-${p}-${idx}`),
                z: Number(q.z ?? 10 + idx),
                type: "quiz",
                payload: {
                    x: Number(q.x ?? 0.1),
                    y: Number(q.y ?? 0.1),
                    w: Number(q.w ?? 0.3),
                    h: Number(q.h ?? 0.2),
                    question: q.question ?? q.payload?.question ?? "",
                    answer: q.answer ?? q.payload?.answer ?? "",
                    ...q.payload,
                },
            }));
    }, [items, previewPage]);

    // 상단 내비
    const dec = () => setPreviewPage((p) => Math.max(1, (p ?? 1) - 1));
    const inc = () => setPreviewPage((p) => Math.max(1, (p ?? 1) + 1));

    // “빈 페이지 추가” (부모에서 낙관적 추가, 자식 연결되면 패치 경유)
    const addBlankPage = () => {
        const make = (): ManifestItem =>
            ({ id: crypto.randomUUID?.() ?? String(Date.now()), type: "page", kind: "page", srcPage: 0 } as any);
        let delegated = false;
        if (applyPatchRef.current) {
            applyPatchRef.current((cur) => { delegated = true; return [...cur, make()]; });
        }
        if (!delegated) setItems((cur) => [...cur, make()]);
    };

    // 왼쪽 세로 스트립용 간단한 페이지 썸네일 목록
    const pageThumbs = useMemo(() => {
        const arr: { id: string; page: number; idx: number }[] = [];
        items.forEach((it, idx) => { if ((it as any)?.type === "page") arr.push({ id: `pg-${idx}`, page: (it as any).srcPage ?? 0, idx }); });
        return arr;
    }, [items]);

    const reorderPages = (next: { id: string; page: number; idx: number }[]) => {
        if (!applyPatchRef.current) return;
        applyPatchRef.current((cur) => {
            const ordered = next.map(t => ({ type: "page", kind: "page", srcPage: t.page } as any));
            let p = 0;
            return cur.map(it => (it as any)?.type === "page" ? (ordered[p++] ?? it) : it);
        });
    };
    const selectThumb = (id: string) => {
        const f = pageThumbs.find(t => t.id === id); if (!f) return;
        setPreviewPage(f.page >= 0 ? f.page : 0);
    };
    const addPage = () => {
        if (!applyPatchRef.current) return;
        const maxPg = Math.max(0, ...pageThumbs.map(t => t.page));
        applyPatchRef.current(cur => ([...cur, { type:"page", kind:"page", srcPage: maxPg + 1 } as any]));
    };
    const duplicatePage = (id: string) => {
        if (!applyPatchRef.current) return;
        const f = pageThumbs.find(t => t.id === id); if (!f) return;
        applyPatchRef.current(cur => { const arr = cur.slice(); arr.splice(f.idx+1,0,{ type:"page", kind:"page", srcPage:f.page } as any); return arr; });
    };
    const deletePage = (id: string) => {
        if (!applyPatchRef.current) return;
        const f = pageThumbs.find(t => t.id === id); if (!f) return;
        applyPatchRef.current(cur => { const arr = cur.slice(); if ((arr[f.idx] as any)?.type==="page") arr.splice(f.idx,1); return arr; });
    };

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

            {/* 프리뷰 상단 컨트롤 + 썸네일 위치 토글 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px 0", flexWrap: "wrap" }}>
                <div className="badge">Zoom</div>
                {[0.5, 0.75, 1, 1.25, 1.5].map((v) => (
                    <button key={v} className={`btn ${zoom === v ? "btn-primary" : ""}`} onClick={() => setZoom(v as any)}>
                        {Math.round(Number(v) * 100)}%
                    </button>
                ))}
                <div className="badge" style={{ marginLeft: 12 }}>비율</div>
                {(["16:9", "16:10", "4:3", "3:2", "A4", "auto"] as const).map((r) => (
                    <button key={r} className={`btn ${aspectMode === r ? "btn-primary" : ""}`} onClick={() => setAspectMode(r)}>{r}</button>
                ))}

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <span className="badge">썸네일</span>
                    <button className={`btn ${thumbPos==="bottom" ? "btn-primary":""}`} onClick={()=>setThumbPos("bottom")}>하단</button>
                    <button className={`btn ${thumbPos==="left" ? "btn-primary":""}`} onClick={()=>setThumbPos("left")}>왼쪽</button>
                    <button className="btn" onClick={addBlankPage}>+ 빈 페이지 추가</button>
                </div>
            </div>

            {loading ? (
                <div className="panel">불러오는 중…</div>
            ) : err ? (
                <div className="panel" style={{ color: "#f87171" }}>{err}</div>
            ) : !deckId || !fileKey ? (
                <div className="panel" style={{ opacity: 0.6 }}>자료 없음</div>
            ) : (
                <div
                    className="panel"
                    style={{
                        display: "grid",
                        gridTemplateColumns: thumbPos === "left"
                            ? `${leftBarWidth}px ${previewCol} ${editorCol}`
                            : `${previewCol} ${editorCol}`,
                        gap: 16,
                        alignItems: "start",
                    }}
                >
                    {/* 왼쪽 세로 스트립 */}
                    {thumbPos === "left" && (
                        <div>
                            <EditorThumbnailStrip
                                fileKey={fileKey ?? null}
                                items={pageThumbs.map(t => ({ id: t.id, page: t.page }))}
                                onReorder={reorderPages}
                                onSelect={selectThumb}
                                onAdd={addPage}
                                onDuplicate={duplicatePage}
                                onDelete={deletePage}
                                orientation="vertical"
                                thumbWidth={leftBarWidth - 24}
                                thumbHeight={Math.round((leftBarWidth - 24) * 0.75)}
                                maxExtent={Math.max(320, (typeof window !== "undefined" ? window.innerHeight : 900) - 240)}
                            />
                        </div>
                    )}

                    {/* 프리뷰 */}
                    <div>
                        <EditorPreviewPane
                            fileKey={fileKey}
                            page={previewBgPage}
                            height="calc(100vh - 220px)"
                            version={cacheVer}
                            overlays={overlaysForPreview}
                            zoom={zoom}
                            aspectMode={aspectMode}
                        />
                    </div>

                    {/* 오른쪽 편집기 (하단 스트립은 토글에 따라 노출) */}
                    <div>
                        <DeckEditor
                            roomCode={roomCode}
                            deckId={deckId}
                            totalPages={totalPages}
                            fileKey={fileKey}
                            onClose={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                            onSaved={() => nav(`/teacher?room=${roomCode}&mode=setup`)}
                            tempCleanup={null}
                            onItemsChange={onItemsChange}
                            onSelectPage={(p) => setPreviewPage(Math.max(0, p))}
                            applyPatchRef={applyPatchRef}
                            showBottomStrip={thumbPos !== "left"}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
