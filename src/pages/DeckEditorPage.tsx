// src/pages/DeckEditorPage.tsx  ★ 전체 교체
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import type { ManifestItem } from "../types/manifest";
import { getManifestByRoom } from "../api/overrides";
import { slidesPrefixOfPresentationsFile } from "../utils/supaFiles";
import type { Overlay } from "../components/SlideStage";

type RoomRow = { id: string; current_deck_id: string | null };

function withSlash(p: string) { return p.endsWith("/") ? p : `${p}/`; }

const [zoom, setZoom] = useState<0.75 | 1 | 1.25>(1);
const [aspectMode, setAspectMode] = useState<"auto" | "16:9" | "4:3" | "A4">("auto");

// DeckEditor 내부 items를 바깥에서 패치하기 위한 ref
const applyPatchRef = useRef<((fn: (cur: ManifestItem[]) => ManifestItem[]) => void) | null>(null);

// 빈 페이지(meta 일치) 추가
const addBlankPage = () => {
    applyPatchRef.current?.((cur) => [
        ...cur,
        { type: "page", kind: "page", srcPage: 0 } as any, // srcPage:0 == 빈 캔버스
    ]);
};

/** prefix 아래 .webp 개수 카운트 */
async function countWebps(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return 0;
    return (data ?? []).filter((f) => /\.webp$/i.test(f.name)).length;
}
/** prefix 아래 1단계 나열 */
async function listFlat(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return [];
    return data ?? [];
}
/** 버킷 내부 복사 (실패 시 download→upload 폴백) */
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
/** 같은 버킷 디렉터리 복사 (.webp만) — 목적지에 .webp가 하나라도 있으면 스킵 */
async function copyDirSameBucket(bucket: string, fromPrefix: string, toPrefix: string, onlyExt: RegExp) {
    const already = await countWebps(bucket, toPrefix);
    if (already > 0) return;
    const src = await listFlat(bucket, fromPrefix);
    for (const f of src) {
        if (!onlyExt.test(f.name)) continue;
        await copyObjectInBucket(bucket, `${withSlash(fromPrefix)}${f.name}`, `${withSlash(toPrefix)}${f.name}`);
    }
}
/** 크로스 버킷 복사 — 목적지에 .webp가 하나라도 있으면 스킵 */
async function copyDirCrossBuckets(
    fromBucket: "presentations" | "slides",
    toBucket: "slides",
    fromPrefix: string,
    toPrefix: string,
    onlyExt: RegExp
) {
    const already = await countWebps(toBucket, toPrefix);
    if (already > 0) return;
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

/** 편집용 덱 생성: PDF 사본 + 기존 WEBP 폴더 복제(재변환 없음) */
async function ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey }: { roomCode: string; fileKey: string; }) {
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

    const [deckId, setDeckId] = useState<string | null>(null);
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);

    const [items, setItems] = useState<ManifestItem[]>([]);
    const [previewPage, setPreviewPage] = useState<number | null>(1);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // 1분 캐시버스터
    const [cacheVer, setCacheVer] = useState<number>(() => Math.floor(Date.now() / 60000));
    useEffect(() => { const t = setInterval(() => setCacheVer(Math.floor(Date.now() / 60000)), 30000); return () => clearInterval(t); }, []);

    const previewOnce = useRef(false);
    const onItemsChange = (next: ManifestItem[]) => setItems(next);

    /* ---------- util: 아이템 → 페이지/오버레이 ---------- */
    function pageNumberOf(item: any): number | null {
        const p = item?.srcPage ?? item?.page ?? item?.targetPage;
        return p == null ? null : Number(p);
    }
    function maxPageFromItems(list: ManifestItem[]): number {
        const pages = list.filter((it: any) => it?.type === "page")
            .map((it) => pageNumberOf(it))
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 1);
        return pages.length ? Math.max(...pages) : 0;
    }
    function overlaysForPage(list: ManifestItem[], page: number): Overlay[] {
        return list
            .filter((it: any) => it?.type && it?.type !== "page")
            .filter((it: any) => Number(pageNumberOf(it)) === Number(page))
            .map((it: any, i: number) => ({
                id: String(it.id ?? `ov-${i}`),
                z: Number(it.z ?? 0),
                type: String(it.type),
                payload: it.payload ?? it,
            }))
            .sort((a, b) => a.z - b.z);
    }

    /* ---------- 초기 로딩 ---------- */
    useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true); setErr(null); setFileKey(null);
            try {
                if (!roomCode && !deckFromQS && !sourceDeckId) throw new Error("room 또는 deck/src 파라미터가 필요합니다.");

                if (sourceDeckKey) {
                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: sourceDeckKey });
                    if (cancel) return;
                    setDeckId(ensured.deckId); setFileKey(ensured.file_key); setTotalPages(ensured.totalPages || 0);
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else if (sourceDeckId) {
                    const { data: src, error: eSrc } = await supabase.from("decks").select("file_key, file_pages").eq("id", sourceDeckId).maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");
                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: src.file_key });
                    if (cancel) return;
                    setDeckId(ensured.deckId); setFileKey(ensured.file_key);
                    setTotalPages(ensured.totalPages || Number(src.file_pages || 0));
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else {
                    const { data: roomRow, error: eRoom } = await supabase
                        .from("rooms").select("id,current_deck_id").eq("code", roomCode).maybeSingle<RoomRow>();
                    if (eRoom) throw eRoom;
                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;
                    if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");

                    setDeckId(pickedDeck);
                    const { data: d, error: eDeck } = await supabase.from("decks").select("file_key,file_pages").eq("id", pickedDeck).maybeSingle();
                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");
                    setFileKey(d.file_key); setTotalPages(Number(d.file_pages || 0));
                }

                try {
                    const m = await getManifestByRoom(roomCode);
                    const arr: ManifestItem[] = Array.isArray(m) ? m : (Array.isArray((m as any)?.items) ? (m as any).items : []);
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

    /* ---------- 프리뷰 최초 페이지 ---------- */
    useEffect(() => {
        if (previewOnce.current || loading) return;
        const firstPage =
            (items.find(x => (x as any).type === "page") as any)?.srcPage
            ?? (totalPages > 0 ? 1 : 0); // totalPages가 0이면 "빈 캔버스" 모드
        setPreviewPage(firstPage);
        previewOnce.current = true;
    }, [loading, items, totalPages]);


    /* ---------- “빈 페이지 추가” 직후: 새 가상 페이지로 포커스 ---------- */
    const lastVirtualMaxRef = useRef(0);
    useEffect(() => {
        const vm = maxPageFromItems(items);
        if (vm > lastVirtualMaxRef.current) setPreviewPage(vm); // 새 페이지가 생기면 그 페이지로
        lastVirtualMaxRef.current = vm;
    }, [items]);

    /* ---------- 프리뷰 계산(배경/오버레이) ---------- */
    const effectiveMax = useMemo(
        () => Math.max(totalPages || 0, maxPageFromItems(items) || 0, 1),
        [totalPages, items]
    );
    const previewBgPage = useMemo(() => {
        const p = Number(previewPage || 0);
        return p >= 1 && p <= (totalPages || 0) ? p : 0; // 파일 밖이면 빈 캔버스
    }, [previewPage, totalPages]);
    const previewOverlays = useMemo<Overlay[]>(
        () => (previewPage ? overlaysForPage(items, previewPage) : []),
        [items, previewPage]
    );

    const overlaysForPreview: Overlay[] = useMemo(() => {
        try {
            const p = Number(previewPage ?? 0);
            if (!p || !Array.isArray(items)) return [];
            // ManifestItem 구조를 보수적으로 처리: type === "quiz" 만 골라 Overlay로 매핑
            // (키 이름이 다르면 안전하게 기본값 처리)
            return items
                .filter((it: any) => (it?.type === "quiz" || it?.kind === "quiz") && Number(it?.srcPage ?? it?.page) === p)
                .map((q: any, idx: number) => ({
                    id: String(q.id ?? `quiz-${p}-${idx}`),
                    z: Number(q.z ?? 10 + idx),
                    type: "quiz",
                    payload: {
                        // 위치/크기 등 에디터가 주는 값을 보수적으로 매핑
                        x: Number(q.x ?? 0.1), y: Number(q.y ?? 0.1),
                        w: Number(q.w ?? 0.3), h: Number(q.h ?? 0.2),
                        question: q.question ?? q.payload?.question ?? "",
                        answer: q.answer ?? q.payload?.answer ?? "",
                        // 필요한 추가 필드가 있으면 SlideStage에서 참조
                        ...q.payload,
                    },
                }));
        } catch { return []; }
    }, [items, previewPage]);

    const dec = () => setPreviewPage((p) => Math.max(1, Math.min(effectiveMax, (p ?? 1) - 1)));
    const inc = () => setPreviewPage((p) => Math.max(1, Math.min(effectiveMax, (p ?? 1) + 1)));

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
            {/* 프리뷰 상단 컨트롤 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px 0" }}>
                <div className="badge">Zoom</div>
                {[0.75, 1, 1.25].map(v => (
                    <button
                        key={v}
                        className={`btn ${zoom === v ? "btn-primary" : ""}`}
                        onClick={() => setZoom(v as 0.75 | 1 | 1.25)}
                    >{Math.round(v * 100)}%</button>
                ))}

                <div className="badge" style={{ marginLeft: 12 }}>비율</div>
                {(["auto","16:9","4:3","A4"] as const).map(r => (
                    <button
                        key={r}
                        className={`btn ${aspectMode === r ? "btn-primary" : ""}`}
                        onClick={() => setAspectMode(r)}
                    >{r}</button>
                ))}

                <div style={{ marginLeft: "auto" }} />
                <button className="btn" onClick={addBlankPage}>+ 빈 페이지 추가</button>
            </div>

            {loading ? (
                <div className="panel">불러오는 중…</div>
            ) : err ? (
                <div className="panel" style={{ color: "#f87171" }}>{err}</div>
            ) : !deckId || !fileKey ? (
                <div className="panel" style={{ opacity: 0.6 }}>자료 없음</div>
            ) : (
                <div className="panel" style={{ display: "grid", gridTemplateColumns: "minmax(420px, 48%) 1fr", gap: 16 }}>
                    <div>
                        <EditorPreviewPane
                            fileKey={fileKey}
                            page={totalPages > 0 ? (previewPage ?? 1) : 0}
                            height="calc(100vh - 220px)"
                            version={cacheVer}
                            overlays={overlaysForPreview}
                            zoom={zoom}
                            aspectMode={aspectMode}
                        />
                    </div>
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
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
