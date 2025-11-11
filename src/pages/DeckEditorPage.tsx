// src/pages/DeckEditorPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import EditorThumbnailStrip from "../components/EditorThumbnailStrip";
import type { ManifestItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";
import { slidesPrefixOfAny } from "../utils/supaFiles";
import type { Overlay } from "../components/SlideStage";
import { safeRpc } from "../utils/supaRpc";

/* ────────────────────────────── types/qs utils ───────────────────────────── */
type RoomRow = { id: string; current_deck_id: string | null };

function sanitizeParam(v?: string | null) {
    return String(v ?? "").split(/[?#]/)[0].trim();
}
function pickUuid(v?: string | null): string | null {
    const s = sanitizeParam(v);
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
}
function withSlash(p: string) { return p.endsWith("/") ? p : `${p}/`; }

/* ───────────────────────────── storage helpers ───────────────────────────── */
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
    if (await countWebps(bucket, toPrefix) > 0) return; // 이미 있으면 스킵
    const src = await listFlat(bucket, fromPrefix);
    for (const f of src) {
        if (!onlyExt.test(f.name)) continue;
        await copyObjectInBucket(bucket, `${withSlash(fromPrefix)}${f.name}`, `${withSlash(toPrefix)}${f.name}`);
    }
}

/* ───────────── slides prefix 해석 → 페이지수(전적으로 WebP 기준) ──────────── */
async function getActualSlidesCountByFileKey(fileKey: string): Promise<number> {
    const prefix = slidesPrefixOfAny(fileKey);
    if (!prefix) return 0;
    const p1 = await countWebps("slides", prefix).catch(() => 0);
    if (p1 > 0) return p1;
    // 과거 slides-TS 디렉토리 구조(있다면)도 보조 확인
    const ts = String(fileKey).match(/slides-(\d+)\.pdf$/i)?.[1] || null;
    if (ts) {
        const p2 = await countWebps("slides", `${prefix}/slides-${ts}`).catch(() => 0);
        if (p2 > 0) return p2;
    }
    return 0;
}

/* ─────────────── 편집용 덱 생성 (room 없으면 라이브러리로 폴백) ────────────── */
async function ensureEditingDeckFromSlidesOnly({
                                                   roomCode, fileKey
                                               }: { roomCode: string; fileKey: string }) {
    // 0) 편집용 deck row
    const ins = await supabase.from("decks").insert({ title: "Untitled (편집)" }).select("id").single();
    if (ins.error) throw ins.error;
    const deckId = ins.data.id as string;

    // 1) roomId (없으면 null 유지 → 라이브러리 경로 사용)
    let roomId: string | null = null;
    if (roomCode) {
        const { data: room } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        roomId = room?.id ?? null;
    }

    // 2) 소스 슬라이드 prefix (pdf든 slides든 OK)
    const srcPrefix = slidesPrefixOfAny(fileKey);
    if (!srcPrefix) throw new Error("source slides not found");

    // 3) 목적지 prefix
    const dstPrefix = roomId
        ? `rooms/${roomId}/decks/${deckId}`
        : `decks/${deckId}`;

    // 4) WebP만 복사
    const srcCount = await countWebps("slides", srcPrefix).catch(() => 0);
    if (srcCount <= 0) throw new Error("no webp slides to copy");
    await copyDirSameBucket("slides", srcPrefix, dstPrefix, /\.webp$/i);

    // 5) 페이지 수 기록 + file_key에 슬라이드 prefix 저장
    const pages = await countWebps("slides", dstPrefix).catch(() => 0);
    await supabase.from("decks")
        .update({ file_key: dstPrefix, file_pages: pages || null })
        .eq("id", deckId);

    return { roomId, deckId, file_key: dstPrefix, totalPages: pages };
}

/* ──────────────────────────────── Component ──────────────────────────────── */
export default function DeckEditorPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = useMemo(() => new URLSearchParams(search), [search]);

    const roomCode     = sanitizeParam(qs.get("room") || "");
    const deckFromQS   = pickUuid(qs.get("deck"));
    const sourceDeckId = pickUuid(qs.get("src"));
    const sourceDeckKey= sanitizeParam(qs.get("srcKey"));
    
    const [zoom, setZoom] = useState<0.5 | 0.75 | 1 | 1.25 | 1.5>(1);
    const [aspectMode, setAspectMode] =
        useState<"auto" | "16:9" | "16:10" | "4:3" | "3:2" | "A4">("16:9");

    const [thumbPos, setThumbPos] = useState<"bottom" | "left">("bottom");
    const leftBarWidth = 164;

    const applyPatchRef = useRef<((fn: (cur: ManifestItem[]) => ManifestItem[]) => void) | null>(null);

    const [deckId, setDeckId] = useState<string | null>(null);
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);

    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, setPreviewPage] = useState<number | null>(1);
    
    const slotFromQS = Math.max(1, Number(new URLSearchParams(search).get("slot") || 1));

    const [roomId, setRoomId] = useState<string | null>(null);
    const [assigned, setAssigned] = useState<boolean>(false);
    const [assigning, setAssigning] = useState<boolean>(false);


    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const previewCol = "minmax(560px, 1.1fr)";
    const editorCol  = "minmax(420px, 0.9fr)";

    // 프리뷰 이미지 캐시버스터(30초)
    const [cacheVer, setCacheVer] = useState<number>(() => Math.floor(Date.now() / 60000));
    useEffect(() => {
        const t = setInterval(() => setCacheVer(Math.floor(Date.now() / 60000)), 30000);
        return () => clearInterval(t);
    }, []);

    const onItemsChange = (next: ManifestItem[]) => setItems(next);

    const maxPageFromItems = (list: ManifestItem[]) =>
        list.filter((it: any) => it?.type === "page").length;

    const clampPage = (p: number | null | undefined) => {
           const max = Math.max(0, Number(totalPages || 0));
           const n = Math.max(0, Number(p ?? 0));  // 0(빈 화면) 허용
           return Math.min(n, Math.max(0, max));
    };

    useEffect(() => { setPreviewPage(p => clampPage(p)); }, [totalPages]);

    // 초기 로드
    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setErr(null);
            setFileKey(null);
            try {
                if (!roomCode && !deckFromQS && !sourceDeckId && !sourceDeckKey) {
                    throw new Error("room 또는 deck/src/srcKey 파라미터가 필요합니다.");
                }

                if (sourceDeckKey) {
                    // srcKey → 바로 복제
                    const ensured = await ensureEditingDeckFromSlidesOnly({ roomCode, fileKey: sourceDeckKey });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    setRoomId(ensured.roomId ?? null);

                    let pages = ensured.totalPages || 0;
                    if (!pages) pages = await getActualSlidesCountByFileKey(ensured.file_key);
                    setTotalPages(pages);
                    if (pages > 0) setCacheVer(v => v + 1);

                } else if (sourceDeckId) {
                    // src(deckId) → 원본의 file_key로 복제
                    const { data: src, error: eSrc } = await supabase
                        .from("decks").select("file_key, file_pages").eq("id", sourceDeckId).maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");

                    const ensured = await ensureEditingDeckFromSlidesOnly({ roomCode, fileKey: src.file_key });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);

                    setRoomId(ensured.roomId ?? null);
                    
                    let pages = ensured.totalPages || Number(src.file_pages || 0);
                    if (!pages) pages = await getActualSlidesCountByFileKey(ensured.file_key);
                    setTotalPages(pages);
                    if (pages > 0) setCacheVer(v => v + 1);

                } else {
                    // room or deck=… → 현재 선택된 덱
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

                    setRoomId(roomRow?.id ?? null);
                    const currentId = roomRow?.current_deck_id ?? null;
                    setAssigned(!!(currentId && pickedDeck && currentId === pickedDeck));

                    let pages = Number(d.file_pages || 0);
                    if (!pages) {
                        pages = await getActualSlidesCountByFileKey(d.file_key);
                        if (pages > 0) {
                            // 보정 저장(선택)
                            await supabase.from("decks").update({ file_pages: pages }).eq("id", pickedDeck);
                        }
                    }
                    setTotalPages(pages);
                }

                // 매니페스트(질문 오버레이 등) 불러오기: 실패해도 UI는 계속
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

    // 프리뷰 초기 페이지 설정: 페이지가 없으면 렌더 skip
    useEffect(() => {
        if (loading) return;
        const hasMetaPages = maxPageFromItems(items) > 0;
        setPreviewPage(hasMetaPages || totalPages > 0 ? 1 : 0);
    }, [loading, items, totalPages]);

    // 프리뷰 계산
    const previewIsBlank = useMemo(() => {
           const pg = Number(previewPage || 0);
           const found = items.find((it: any) => it?.type === "page" && Number(it?.srcPage ?? -1) === pg);
           return !!(found as any)?.blank || !!(found as any)?.isBlank;
         }, [items, previewPage]);
    
    const overlaysForPreview: Overlay[] = useMemo(() => {
        const p = Number(previewPage ?? 0);
        if (!p || !Array.isArray(items)) return [];
        return items
                    // 붙일 페이지 우선(없으면 srcPage)
                    .filter((it: any) => {
                      if (!(it?.type === "quiz" || it?.kind === "quiz")) return false;
                      const pageRef = Number(it.attachToSrcPage ?? it.srcPage ?? it.page ?? 0);
                      return pageRef === p;
                    })
                .map((q: any, idx: number) => {
                      // 위치 프리셋(tl/tr/bl/br) → x,y 기본값
                          const pos = q.position ?? "tl";
                      const defXY: Record<string, [number, number]> = {
                            tl: [0.06, 0.06], tr: [0.64, 0.06], bl: [0.06, 0.72], br: [0.64, 0.72],
                            free: [0.1, 0.1],
                          };
                      const [dx, dy] = defXY[pos] ?? [0.1, 0.1];
                      const x = Number(q.posX ?? q.x ?? dx);
                      const y = Number(q.posY ?? q.y ?? dy);
                      const w = Number(q.w ?? 0.3);
                      const h = Number(q.h ?? 0.2);
                      return ({
                id: String(q.id ?? `quiz-${p}-${idx}`),
                z: Number(q.z ?? 10 + idx),
                type: "quiz",
                payload: {
                    x, y, w, h,
                    // 🔑 QuizOverlay가 읽는 키
                    prompt: q.prompt ?? q.payload?.prompt ?? "",
                    keywords: Array.isArray(q.keywords) ? q.keywords : (q.payload?.keywords ?? []),
                    threshold: Number(q.threshold ?? q.payload?.threshold ?? 1),
                    // 색상(양쪽 키 모두 허용)
                    bg: q.bg ?? q.bgColor ?? q.payload?.bg ?? q.payload?.bgColor ?? "rgba(17,24,39,.85)",
                    fg: q.fg ?? q.fgColor ?? q.payload?.fg ?? q.payload?.fgColor ?? "#fff",
                    ...q.payload, // (마지막 병합 유지)
                },
                      });
                });
    }, [items, previewPage]);

    // 상단 내비
    const dec = () => setPreviewPage((p) => clampPage((p ?? 1) - 1));
    const inc = () => setPreviewPage((p) => clampPage((p ?? 1) + 1));

    const previewKey = fileKey || null;

    // “빈 페이지 추가” (낙관적 추가)
    const addBlankPage = () => {
           if (!applyPatchRef.current) return;
           const maxPg = Math.max(0, ...pageThumbs.map(t => t.page));
           const id = crypto.randomUUID?.() ?? String(Date.now());
           applyPatchRef.current(cur => ([...cur, { id, type: "page", kind: "page", srcPage: maxPg + 1, blank: true } as any]));
           setPreviewPage(maxPg + 1);
         };

    // 왼쪽 세로 스트립용 썸네일 목록
    const pageThumbs = useMemo(() => {
           const arr: { id: string; page: number; idx: number; blank?: boolean }[] = [];
           items.forEach((it, idx) => {
                 if ((it as any)?.type === "page") {
                       const pg = Number((it as any).srcPage ?? 0);
                       const blank = !!(it as any).blank || !!(it as any).isBlank;
                       arr.push({ id: `pg-${idx}`, page: pg, idx, blank });
                     }
               });
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
        setPreviewPage(clampPage(f.page));
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
                    <div className="badge">p.{previewPage ?? 0} / {totalPages || 0}</div>
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
            ) : !deckId && !fileKey ? (
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
                                items={pageThumbs.map(t => ({ id: t.id, page: t.page, blank: t.blank }))}
                                version={cacheVer}
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

                    {/* 프리뷰 (페이지 1 이상일 때만 렌더 → 0.webp 방지) */}
                    <div>
                        <EditorPreviewPane
                           fileKey={fileKey ?? ""}
                           // 빈 페이지(0)는 URL 생성이 필요 없으므로 page는 아무 값이나 가능
                           page={Number(previewPage || 0) <= 0 ? 1 : Number(previewPage)}
                           isBlank={previewIsBlank}
                           version={cacheVer}
                           overlays={overlaysForPreview}
                           zoom={zoom}
                           aspectMode={aspectMode}
                        />
                    </div>

                    {/* 오른쪽 편집기 */}
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
                            onSelectPage={(p) => setPreviewPage(p)}
                            applyPatchRef={applyPatchRef}
                            showBottomStrip={thumbPos !== "left"}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
