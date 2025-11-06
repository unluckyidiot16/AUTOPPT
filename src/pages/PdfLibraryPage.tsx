// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import { getPdfUrlFromKey } from "../utils/supaFiles";

type DeckRow = {
    id: string;
    title: string | null;
    file_key: string | null;
    file_pages: number | null;
};

function useSignedUrl(key: string | null | undefined, ttlSec = 1800) {
    const [url, setUrl] = React.useState<string>("");
    React.useEffect(() => {
        let alive = true;
        (async () => {
            if (!key) {
                setUrl("");
                return;
            }
            try {
                const u = await getPdfUrlFromKey(key, { ttlSec });
                if (alive) setUrl(u);
            } catch {
                if (alive) setUrl("");
            }
        })();
        return () => {
            alive = false;
        };
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
        return () => {
            alive = false;
        };
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
        return decks.filter((d) => (d.title || "").toLowerCase().includes(k));
    }, [decks, keyword]);

    React.useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                // 자료함: 단순히 decks 테이블 목록을 불러온다.
                // (RLS/정렬 컬럼은 프로젝트마다 다르니, 안전하게 최소 컬럼만)
                const { data, error: e } = await supabase
                    .from("decks")
                    .select("id,title,file_key,file_pages")
                    .limit(200);
                if (e) throw e;
                if (!cancel) setDecks((data as DeckRow[]) || []);
            } catch (e: any) {
                if (!cancel) setError(e?.message || "목록을 불러오지 못했어요.");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => {
            cancel = true;
        };
    }, []);

    const openEditClone = React.useCallback(
        (d: DeckRow) => {
            if (!roomCode) {
                alert("room 파라미터가 필요합니다.");
                return;
            }
            if (!d.file_key) {
                alert("원본 덱에 파일이 없습니다.");
                return;
            }
            nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
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
                    placeholder="제목으로 검색…"
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
                style={{
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                }}
            >
                {filtered.map((d) => (
                    <div
                        key={d.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col"
                    >
                        <div className="text-sm font-medium mb-2 line-clamp-2">{d.title || "Untitled"}</div>
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
                                onClick={() => openEditClone(d)}
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
        // 파일 바뀌면 1페이지로
        setPage(1);
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
                        <button
                            className="px-2 py-1 rounded-md border"
                            onClick={dec}
                            disabled={page <= 1}
                        >
                            ◀
                        </button>
                        <div className="text-sm tabular-nums">
                            {page} / {total}
                        </div>
                        <button
                            className="px-2 py-1 rounded-md border"
                            onClick={inc}
                            disabled={page >= total}
                        >
                            ▶
                        </button>
                        <button
                            className="px-3 py-1.5 rounded-md bg-slate-800 text-white"
                            onClick={onClose}
                        >
                            닫기
                        </button>
                    </div>
                </div>

                <div
                    className="pdf-stage"
                    style={{
                        flex: 1,
                        overflow: "auto",
                        background: "#f3f4f6",
                        padding: 12,
                        display: "grid",
                        placeItems: "center",
                    }}
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
