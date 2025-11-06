// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import { getPdfUrlFromKey } from "../utils/supaFiles";

type DeckRow = {
    id: string;                         // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null;
    file_pages: number | null;
    origin: "db" | "storage";
};

function useSignedUrl(key: string | null | undefined, ttlSec = 1800) {
    const [url, setUrl] = React.useState<string>("");
    React.useEffect(() => {
        let alive = true;
        (async () => {
            if (!key) { setUrl(""); return; }
            try {
                const u = await getPdfUrlFromKey(key, { ttlSec });
                if (alive) setUrl(u);
            } catch {
                if (alive) setUrl("");
            }
        })();
        return () => { alive = false; };
    }, [key, ttlSec]);
    return url;
}

function Thumb({ keyStr }: { keyStr: string }) {
    const fileUrl = useSignedUrl(keyStr);
    return (
        <div
            className="pdf-thumb"
            style={{
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 8,
                border: "1px solid rgba(148,163,184,0.25)",
                height: 140,
                display: "grid",
                placeItems: "center",
                background: "#fff",
            }}
        >
            {fileUrl ? <PdfViewer fileUrl={fileUrl} page={1} maxHeight="140px" /> : <div style={{ height: 140 }} />}
        </div>
    );
}

function OpenSignedLink({ fileKey, children }: { fileKey: string; children: React.ReactNode }) {
    const [href, setHref] = React.useState<string>("");
    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const u = await getPdfUrlFromKey(fileKey, { ttlSec: 1800 });
                if (alive) setHref(u);
            } catch {
                if (alive) setHref("");
            }
        })();
        return () => { alive = false; };
    }, [fileKey]);
    return (
        <a className="btn" href={href || "#"} target="_blank" rel="noreferrer" aria-disabled={!href}>
            {children}
        </a>
    );
}

export default function PdfLibraryPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = React.useMemo(() => new URLSearchParams(search), [search]);
    const roomCode = qs.get("room") || "";

    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [decks, setDecks] = React.useState<DeckRow[]>([]);
    const [keyword, setKeyword] = React.useState("");

    const [preview, setPreview] = React.useState<DeckRow | null>(null);
    const [previewPage, setPreviewPage] = React.useState<number>(1);

    const filtered = React.useMemo(() => {
        if (!keyword.trim()) return decks;
        const k = keyword.trim().toLowerCase();
        return decks.filter((d) =>
            (d.title || "").toLowerCase().includes(k) ||
            (d.file_key || "").toLowerCase().includes(k)
        );
    }, [decks, keyword]);

    // ---------- Storage 인덱스 스캐너 (presentations/decks/*/slides-*.pdf) ----------
    async function fetchFromStorage(limitFolders = 120): Promise<DeckRow[]> {
        type SFile = { name: string; updated_at?: string | null; created_at?: string | null; };
        const bucket = supabase.storage.from("presentations");

        // 1) 상위 폴더(= deckId로 쓰는 UUID 폴더) 나열
        const top = await bucket.list("decks", {
            limit: 1000,
            sortBy: { column: "updated_at", order: "desc" },
        });
        if (top.error) throw top.error;

        const folders = (top.data || []).slice(0, limitFolders).map((f) => f.name).filter(Boolean);

        const rows: DeckRow[] = [];
        for (const folder of folders) {
            const path = `decks/${folder}`;
            // 2) 각 폴더 내 PDF 파일 조회(최신 우선)
            const ls = await bucket.list(path, {
                limit: 50,
                sortBy: { column: "updated_at", order: "desc" },
            });
            if (ls.error) continue;
            const files = (ls.data as SFile[]) || [];
            // slides-*.pdf 우선, 없으면 아무 pdf
            const pick =
                files.find((f) => /slides-.*\.pdf$/i.test(f.name)) ||
                files.find((f) => /\.pdf$/i.test(f.name));
            if (!pick) continue;

            const file_key = `${path}/${pick.name}`;
            rows.push({
                id: `s:${file_key}`,
                title: folder,                // 폴더명을 제목으로 (간단)
                file_key,
                file_pages: null,
                origin: "storage",
            });
            // 결과가 너무 많아지는 것 방지
            if (rows.length >= 200) break;
        }
        return rows;
    }

    // ---------- RPC 우선 + Storage 병합 ----------
    React.useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                let merged: DeckRow[] = [];

                // 1) RPC (DB)
                try {
                    const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                    if (error) throw error;
                    const dbRows: DeckRow[] = (data || []).map((d: any) => ({
                        id: d.id,
                        title: d.title ?? null,
                        file_key: d.file_key ?? null,
                        file_pages: d.file_pages ?? null,
                        origin: "db" as const,
                    }));
                    merged = dbRows;
                    console.debug("[LIB] rpc:list_library_decks =", dbRows.length);
                } catch (e) {
                    console.debug("[LIB] rpc failed, fallback SELECT", e);
                    const { data: anyDecks, error: eAll } = await supabase
                        .from("decks")
                        .select("id,title,file_key,file_pages")
                        .not("file_key", "is", null)
                        .limit(200);
                    if (!eAll) {
                        merged = (anyDecks || []).map((d: any) => ({
                            id: d.id,
                            title: d.title ?? null,
                            file_key: d.file_key ?? null,
                            file_pages: d.file_pages ?? null,
                            origin: "db" as const,
                        }));
                    }
                }

                // 2) Storage 스캔 병합(중복 file_key 제거)
                try {
                    const sRows = await fetchFromStorage(120);
                    const byKey = new Map<string, DeckRow>();
                    for (const r of merged) if (r.file_key) byKey.set(r.file_key, r);
                    for (const r of sRows) {
                        if (!r.file_key) continue;
                        if (!byKey.has(r.file_key)) byKey.set(r.file_key, r);
                    }
                    merged = Array.from(byKey.values());
                    console.debug("[LIB] storage merged total =", merged.length);
                } catch (e) {
                    console.debug("[LIB] storage scan failed", e);
                }

                if (!cancel) setDecks(merged);
                if (!cancel && merged.length === 0) {
                    setError("표시할 자료가 없습니다. (DB/RPC 또는 스토리지에 자료 없음)");
                }
            } catch (e: any) {
                if (!cancel) setError(e?.message || "목록을 불러오지 못했어요.");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, []);

    const openEdit = React.useCallback(
        (d: DeckRow) => {
            if (!roomCode) {
                alert("room 파라미터가 필요합니다.");
                return;
            }
            if (!d.file_key) {
                alert("파일이 없습니다.");
                return;
            }
            if (d.origin === "db") {
                // DB 덱 → 복제 편집 (src=덱ID)
                nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
            } else {
                // 스토리지 전용 → 파일키 기반 복제 편집 (srcKey=파일키)
                nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(d.file_key)}`);
            }
        },
        [nav, roomCode]
    );

    return (
        <div className="px-4 py-4 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-3">
                <h1 className="text-xl font-semibold">자료함</h1>
                <div className="text-sm opacity-70">room: <code>{roomCode || "(미지정)"}</code></div>
            </div>

            <div className="flex items-center gap-2 mb-4">
                <input
                    className="px-3 py-2 rounded-md border border-slate-300 w-full"
                    placeholder="제목/경로 검색…"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                />
                <button
                    className="px-3 py-2 rounded-md border border-slate-300 bg-white"
                    onClick={() => setKeyword("")}
                >
                    초기화
                </button>
            </div>

            {loading && <div className="opacity-70">불러오는 중…</div>}
            {error && <div className="text-red-500">{error}</div>}

            {!loading && !error && filtered.length === 0 && (
                <div className="opacity-60">자료가 없습니다.</div>
            )}

            <div
                className="grid gap-4"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
            >
                {filtered.map((d) => (
                    <div
                        key={d.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col"
                    >
                        <div className="text-sm font-medium mb-1 line-clamp-2">{d.title || "Untitled"}</div>
                        <div className="text-[11px] opacity-60 mb-2">
                            {d.origin === "db" ? "DB" : "Storage"} {d.file_key ? `· ${d.file_key}` : ""}
                        </div>

                        {d.file_key ? <Thumb keyStr={d.file_key} /> : <div className="h-[140px] bg-slate-100 rounded-md mb-2" />}

                        <div className="mt-auto flex items-center gap-2">
                            {d.file_key && <OpenSignedLink fileKey={d.file_key}>링크 열기</OpenSignedLink>}
                            <button
                                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white ml-auto"
                                onClick={() => setPreview(d)}
                            >
                                미리보기
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white"
                                onClick={() => openEdit(d)}
                            >
                                편집
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Preview Modal */}
            {preview && (
                <PreviewModal
                    deck={preview}
                    onClose={() => setPreview(null)}
                    page={previewPage}
                    setPage={setPreviewPage}
                />
            )}
        </div>
    );
}

function PreviewModal({
                          deck,
                          onClose,
                          page,
                          setPage,
                      }: {
    deck: DeckRow;
    onClose: () => void;
    page: number;
    setPage: (n: number) => void;
}) {
    const fileUrl = useSignedUrl(deck.file_key);
    const total = Math.max(1, Number(deck.file_pages || 1));

    const dec = React.useCallback(() => setPage(Math.max(1, page - 1)), [page, setPage]);
    const inc = React.useCallback(() => setPage(Math.min(total, page + 1)), [page, setPage, total]);

    React.useEffect(() => {
        setPage(1); // 파일 바뀌면 1페이지로
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deck.id]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 grid"
            style={{ placeItems: "center" }}
            role="dialog"
            aria-modal="true"
        >
            <div className="bg-white rounded-xl w-[min(1000px,92vw)] h-[min(90vh,900px)] shadow-xl flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                    <div className="font-medium truncate">{deck.title || "Untitled"}</div>
                    <div className="ml-auto flex items-center gap-2">
                        <button className="px-2 py-1 rounded-md border" onClick={dec} disabled={page <= 1}>◀</button>
                        <div className="text-sm tabular-nums">{page} / {total}</div>
                        <button className="px-2 py-1 rounded-md border" onClick={inc} disabled={page >= total}>▶</button>
                        <button className="px-3 py-1.5 rounded-md bg-slate-800 text-white" onClick={onClose}>닫기</button>
                    </div>
                </div>

                <div
                    className="pdf-stage"
                    style={{ flex: 1, overflow: "auto", background: "#f3f4f6", padding: 12, display: "grid", placeItems: "center" }}
                >
                    {fileUrl ? (
                        <PdfViewer fileUrl={fileUrl} page={page} maxHeight="80vh" />
                    ) : (
                        <div style={{ padding: 16, textAlign: "center", opacity: 0.6 }}>파일을 불러올 수 없습니다.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
