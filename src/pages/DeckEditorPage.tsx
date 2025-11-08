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

function withSlash(p: string) {
    return p.endsWith("/") ? p : `${p}/`;
}

/** prefix 아래 .webp 개수 카운트 */
async function countWebps(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return 0;
    return (data ?? []).filter((f) => /\.webp$/i.test(f.name)).length;
}

/** prefix 아래 파일 전체 나열 (상위 한 단계) */
async function listFlat(bucket: string, prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(withSlash(prefix), { limit: 1000 });
    if (error) return [];
    return data ?? [];
}

/** 버킷 내부 복사 (copy 실패 시 download→upload 폴백) */
async function copyObjectInBucket(bucket: string, from: string, to: string, contentType?: string) {
    // 1) 빠른 copy
    try {
        const { error } = await supabase.storage.from(bucket).copy(from, to);
        if (!error) return;
    } catch { /* no-op */ }

    // 2) 폴백: download → upload
    const dl = await supabase.storage.from(bucket).download(from);
    if (dl.error) throw dl.error;
    const up = await supabase.storage.from(bucket).upload(to, dl.data, { upsert: true, contentType });
    if (up.error) throw up.error;
}

/** 같은 버킷 내 디렉터리 복사 (.webp만) — 목적지에 .webp가 하나라도 있으면 스킵 */
async function copyDirSameBucket(bucket: string, fromPrefix: string, toPrefix: string, onlyExt: RegExp) {
    const already = await countWebps(bucket, toPrefix);
    if (already > 0) return; // ★ .webp 기준으로만 스킵

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
    if (already > 0) return; // ★ .webp 기준으로만 스킵

    const src = await listFlat(fromBucket, fromPrefix);
    for (const f of src) {
        if (!onlyExt.test(f.name)) continue;

        // 빠른 copy가 없으므로 download → upload
        const dl = await supabase.storage.from(fromBucket).download(`${withSlash(fromPrefix)}${f.name}`);
        if (dl.error) throw dl.error;
        const up = await supabase.storage.from(toBucket).upload(`${withSlash(toPrefix)}${f.name}`, dl.data, {
            upsert: true,
            contentType: "image/webp",
        });
        if (up.error) throw up.error;
    }
}

/**
 * 원본 presentations/* fileKey 로부터 편집용 덱을 생성.
 * PDF는 presentations 버킷에 사본만, WEBP는 이미 만들어진 것이 있으면 폴더 복제(재변환 없음).
 * 목적지에 .webp가 없을 때만 복제한다(★ 핵심 수정).
 */
async function ensureEditingDeckFromFileKey_noConvert({
                                                          roomCode,
                                                          fileKey,
                                                      }: {
    roomCode: string;
    fileKey: string;
}) {
    // room
    const { data: room, error: eRoom } = await supabase
        .from("rooms")
        .select("id")
        .eq("code", roomCode)
        .maybeSingle();
    if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
    const roomId = room.id as string;

    // 새 덱
    const ins = await supabase.from("decks").insert({ title: "Untitled (편집)" }).select("id").single();
    if (ins.error) throw ins.error;
    const deckId = ins.data.id as string;

    // PDF 사본 (presentations 버킷)
    const ts = Date.now();
    const destPdfKey = `rooms/${roomId}/decks/${deckId}/slides-${ts}.pdf`;
    const srcRel = String(fileKey).replace(/^presentations\//i, "");
    await copyObjectInBucket("presentations", srcRel, destPdfKey, "application/pdf");

    // WEBP 복제: 항상 slides 버킷의 rooms/<rid>/decks/<deckId>로 정규화
    const srcPrefix =
        slidesPrefixOfPresentationsFile(fileKey) ??
        slidesPrefixOfPresentationsFile(srcRel) ??
        null; // 유연 처리
    const dstPrefix = `rooms/${roomId}/decks/${deckId}`;

    // 1) 우선 slides 버킷 원본이 있으면 same-bucket 복사
    if (srcPrefix) {
        const srcSlidesCount = await countWebps("slides", srcPrefix).catch(() => 0);
        if (srcSlidesCount > 0) {
            await copyDirSameBucket("slides", srcPrefix, dstPrefix, /\.webp$/i);
        } else {
            // 2) (레거시) presentations 버킷에도 .webp가 있는 경우 크로스 복사
            const legacyCount = await countWebps("presentations", srcPrefix).catch(() => 0);
            if (legacyCount > 0) {
                await copyDirCrossBuckets("presentations", "slides", srcPrefix, dstPrefix, /\.webp$/i);
            }
        }
    }

    // 목적지 기준 페이지 수 확정
    const pages = await countWebps("slides", dstPrefix).catch(() => 0);

    // 덱 메타 업데이트
    await supabase.from("decks").update({ file_key: destPdfKey, file_pages: pages || null }).eq("id", deckId);

    return { roomId, deckId, file_key: destPdfKey, totalPages: pages };
}

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

    // 1분 단위 캐시버스터 (프리뷰 강제 갱신)
    const [cacheVer, setCacheVer] = useState<number>(() => Math.floor(Date.now() / 60000));
    useEffect(() => {
        const t = setInterval(() => setCacheVer(Math.floor(Date.now() / 60000)), 30000);
        return () => clearInterval(t);
    }, []);

    const previewOnce = useRef(false);
    const onItemsChange = (next: ManifestItem[]) => setItems(next);

    function pageNumberOf(item: any): number | null {
        const p = item?.srcPage ?? item?.page ?? item?.targetPage;
        return p == null ? null : Number(p);
    }

    function maxPageFromItems(items: ManifestItem[]): number {
        const pages = items
            .filter((it: any) => (it?.type === "page"))
            .map((it) => pageNumberOf(it))
            .filter((n): n is number => Number.isFinite(n) && n! >= 1);
        return pages.length ? Math.max(...pages) : 0;
    }

    function overlaysForPage(items: ManifestItem[], page: number): Overlay[] {
        return items
            .filter((it: any) => it?.type && it?.type !== "page")
            .filter((it: any) => Number(pageNumberOf(it)) === Number(page))
            .map((it: any, i: number) => ({
                id: String(it.id ?? `ov-${i}`),
                z: Number(it.z ?? 0),
                type: String(it.type),       // "quiz" 등
                payload: it.payload ?? it,   // SlideStage 쪽에서 해석
            }));
    }

    useEffect(() => {
        let cancel = false;

        (async () => {
            setLoading(true);
            setErr(null);
            setFileKey(null);

            try {
                if (!roomCode && !deckFromQS && !sourceDeckId) {
                    throw new Error("room 또는 deck/src 파라미터가 필요합니다.");
                }

                // ── 진입 분기 ─────────────────────────────────────────────
                if (sourceDeckKey) {
                    // 파일 키(원본)로부터 복제(재변환 없이 .webp만 복사)
                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: sourceDeckKey });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    setTotalPages(ensured.totalPages || 0);
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else if (sourceDeckId) {
                    // 기존 덱 id → file_key 읽어서 동일 처리
                    const { data: src, error: eSrc } = await supabase
                        .from("decks")
                        .select("file_key, file_pages")
                        .eq("id", sourceDeckId)
                        .maybeSingle();
                    if (eSrc) throw eSrc;
                    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");

                    const ensured = await ensureEditingDeckFromFileKey_noConvert({ roomCode, fileKey: src.file_key });
                    if (cancel) return;
                    setDeckId(ensured.deckId);
                    setFileKey(ensured.file_key);
                    setTotalPages(ensured.totalPages || Number(src.file_pages || 0));
                    if ((ensured.totalPages || 0) > 0) setCacheVer((v) => v + 1);
                } else {
                    // 현재 선택된 덱 그대로 편집 (복제 아님)
                    const { data: roomRow, error: eRoom } = await supabase
                        .from("rooms")
                        .select("id,current_deck_id")
                        .eq("code", roomCode)
                        .maybeSingle<RoomRow>();
                    if (eRoom) throw eRoom;

                    const pickedDeck = (deckFromQS as string | null) ?? roomRow?.current_deck_id ?? null;
                    if (!pickedDeck) throw new Error("현재 선택된 자료(교시)가 없습니다. 교사 화면에서 먼저 선택하세요.");

                    setDeckId(pickedDeck);
                    const { data: d, error: eDeck } = await supabase
                        .from("decks")
                        .select("file_key,file_pages")
                        .eq("id", pickedDeck)
                        .maybeSingle();
                    if (eDeck) throw eDeck;
                    if (!d?.file_key) throw new Error("deck file not found");

                    setFileKey(d.file_key);
                    setTotalPages(Number(d.file_pages || 0));
                }

                // manifest(있으면) 로드 — 실패해도 편집은 진행
                try {
                    const m = await getManifestByRoom(roomCode);
                    const arr: ManifestItem[] = Array.isArray(m)
                        ? m
                        : Array.isArray((m as any)?.items)
                            ? (m as any).items
                            : [];
                    if (!cancel) setItems(arr);
                } catch {
                    /* ignore */
                }
            } catch (e: any) {
                if (!cancel) setErr(e?.message || "로드 실패");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();

        return () => {
            cancel = true;
        };
    }, [roomCode, deckFromQS, sourceDeckId, sourceDeckKey]);

    // 프리뷰 최초 페이지 결정
    useEffect(() => {
        if (previewOnce.current || loading) return;
        const firstPage =
            (items.find((x) => (x as any).type === "page") as any)?.srcPage ??
            (totalPages > 0 ? 1 : 0);
        setPreviewPage(firstPage);
        previewOnce.current = true;
    }, [loading, items, totalPages]);

    const maxPage = Math.max(1, Number(totalPages || 1));
    const dec = () => setPreviewPage((p) => Math.max(1, Math.min(maxPage, (p ?? 1) - 1)));
    const inc = () => setPreviewPage((p) => Math.max(1, Math.min(maxPage, (p ?? 1) + 1)));

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
                <div className="panel" style={{ display: "grid", gridTemplateColumns: "minmax(420px, 48%) 1fr", gap: 16 }}>
                    <div>
                        <EditorPreviewPane
                            fileKey={fileKey}
                            page={previewBgPage}                               // ★ 가상 페이지면 0(빈 캔버스)
                            height="calc(100vh - 220px)"
                            version={cacheVer}
                            overlays={previewOverlays}                         // ★ 현재 페이지 오버레이 전달(퀴즈 등)
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
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
