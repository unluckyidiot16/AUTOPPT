// src/components/DeckEditor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ManifestItem, ManifestPageItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom, upsertManifest } from "../api/overrides";
import EditorThumbnailStrip from "./EditorThumbnailStrip";

type MatchOptions = { enableSubstr?: boolean; minLen?: number; synonyms?: Record<string, string[]> };
type QuizX = ManifestQuizItem & { matchOptions?: MatchOptions; attachToSrcPage?: number }; // ✅ 붙일 페이지

function ensureManifestPages(totalPages: number): ManifestPageItem[] {
    const n = Math.max(0, Number(totalPages) || 0);
    return Array.from({ length: n }, (_, i) => ({ type: "page", srcPage: i + 1 }));
}

export default function DeckEditor({
                                       roomCode, deckId, totalPages, fileUrl, onClose, onSaved,
                                       onItemsChange, onSelectPage,
                                   }: {
    roomCode: string; deckId: string; totalPages: number | null; fileUrl?: string | null;
    onClose: () => void; onSaved?: () => void;
    onItemsChange?: (items: ManifestItem[]) => void; // ✅ 프리뷰 동기화용
    onSelectPage?: (srcPage: number) => void;        // ✅ 썸네일/입력에서 선택 시
}) {
    const [items, _setItems] = useState<ManifestItem[]>([]);
    const [loading, setLoading] = useState(true);

    // setItems → 콜백 동기 호출
    const setItems = (updater: ManifestItem[] | ((prev: ManifestItem[]) => ManifestItem[])) => {
        _setItems(prev => {
            const next = typeof updater === "function" ? (updater as any)(prev) : updater;
            try { onItemsChange?.(next); } catch {}
            return next;
        });
    };

    const LS_KEY = "autoppt:matchDefaults";
    const [defaults, setDefaults] = useState<Required<MatchOptions>>(() => {
        try {
            const j = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
            return {
                enableSubstr: j.enableSubstr ?? true,
                minLen: Math.max(2, Number(j.minLen ?? 2)),
                synonyms: (j.synonyms && typeof j.synonyms === "object") ? j.synonyms : {},
            };
        } catch { return { enableSubstr: true, minLen: 2, synonyms: {} }; }
    });
    useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(defaults)); }, [defaults]);

    const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const m = await getManifestByRoom(roomCode);
                let next = m;
                const hasPage = next.some(it => it.type === "page");
                if ((!next.length || !hasPage) && (totalPages ?? 0) > 0) {
                    const pages = ensureManifestPages(totalPages!);
                    const quizzes = next.filter(it => it.type !== "page");
                    next = [...pages, ...quizzes];
                }
                setItems(next);
            } finally { setLoading(false); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCode, totalPages]); // setItems가 콜백을 호출하므로 deps 분리

    const resetDefault = () => {
        if (!totalPages) return;
        const pages = ensureManifestPages(totalPages);
        const quizzes = items.filter(it => it.type !== "page");
        setItems([...pages, ...quizzes]);
    };

    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        setItems(arr => {
            const next = arr.slice();
            const t = next[i]; next[i] = next[j]; next[j] = t;
            return next;
        });
    };
    const removeAt = (i: number) => setItems(items.filter((_, k) => k !== i));
    const duplicateAt = (i: number) => setItems((arr) => [...arr.slice(0, i + 1), arr[i], ...arr.slice(i + 1)]);
    const pushPage = (srcPage: number) => setItems((arr) => [...arr, { type: "page", srcPage } as ManifestPageItem]);
    const pushBlankPage = () => setItems((arr) => [...arr, { type: "page", srcPage: 0 } as ManifestPageItem]); // ✅ 빈 페이지
    const pushQuiz = () => setItems((arr) => [...arr, {
        type: "quiz", prompt: "문제를 입력하세요", keywords: [], threshold: 1, autoAdvance: false,
        matchOptions: { enableSubstr: defaults.enableSubstr, minLen: defaults.minLen, synonyms: { ...defaults.synonyms } },
        attachToSrcPage: 0, // 기본: 빈 화면
    } as QuizX]);

    const save = async () => {
        await upsertManifest(roomCode, deckId, items);
        onSaved?.();
        onClose();
    };

    function SynonymsEditor({ quiz, index }: { quiz: QuizX; index: number }) {
        const map = quiz.matchOptions?.synonyms ?? {};
        const entries = useMemo(() => Object.entries(map), [map]);
        const updateMap = (fn: (cur: Record<string, string[]>) => Record<string, string[]>) => {
            setItems(prev => {
                const next = prev.slice();
                const q = (next[index] as QuizX);
                const mo = q.matchOptions ?? (q.matchOptions = {});
                mo.synonyms = fn({ ...(mo.synonyms ?? {}) });
                return next;
            });
        };
        return (
            <div className="panel" style={{ display: "grid", gap: 8, background: "#0b1220" }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>동의어 테이블</div>
                {entries.length === 0 && <div style={{ opacity: .6 }}>등록된 동의어가 없습니다.</div>}
                {entries.map(([base, syns]) => (
                    <div key={base} style={{
                        display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 6, alignItems: "center",
                        border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8, padding: 6
                    }}>
                        <input className="input" defaultValue={base} placeholder="기준어"
                               onBlur={(e) => {
                                   const nb = e.target.value.trim();
                                   updateMap(cur => {
                                       const copy = { ...cur }; const old = copy[base] ?? []; delete copy[base];
                                       if (nb) copy[nb] = old; return copy;
                                   });
                               }} />
                        <input className="input" defaultValue={syns.join(", ")} placeholder="동의어(쉼표)"
                               onBlur={(e) => {
                                   const ns = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                   updateMap(cur => ({ ...cur, [base]: ns }));
                               }} />
                        <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn" onClick={() => updateMap(cur => ({ ...cur, "": [] }))}>+ 행</button>
                            <button className="btn" onClick={() => updateMap(cur => { const c = { ...cur }; delete c[base]; return c; })}>삭제</button>
                        </div>
                    </div>
                ))}
                {entries.length === 0 && (
                    <button className="btn" onClick={() => updateMap(cur => ({ ...cur, "": [] }))}>+ 행 추가</button>
                )}
            </div>
        );
    }

    const pageThumbs = useMemo(() => {
        const arr: { id: string; page: number; idx: number }[] = [];
        items.forEach((it, idx) => {
            if (it.type === "page") {
                const pg = (it as ManifestPageItem).srcPage;
                arr.push({ id: `pg-${idx}-${pg}`, page: pg, idx });
            }
        });
        return arr;
    }, [items]);

    const pagesList = useMemo(() => {
        // 선택 상자용: 0(빈 화면) + 존재하는 페이지 목록
        const pgs = [0, ...items.filter(i => i.type === "page").map(i => (i as ManifestPageItem).srcPage)]
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => a - b);
        return pgs;
    }, [items]);

    const scrollToIndex = (i: number) => {
        const el = cardRefs.current.get(i);
        if (el) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            setHighlightIdx(i); setTimeout(() => setHighlightIdx(null), 800);
        }
    };

    const onReorderPages = (nextThumbs: { id: string; page: number; idx: number }[]) => {
        const orderedPages = nextThumbs.map(t => ({ type: "page", srcPage: t.page } as ManifestPageItem));
        let pageCursor = 0;
        const next: ManifestItem[] = items.map(it => {
            if (it.type === "page") { const rep = orderedPages[pageCursor++]; return rep ?? it; }
            return it;
        });
        setItems(next);
    };

    const onDuplicatePage = (id: string) => {
        const found = pageThumbs.find(t => t.id === id);
        if (!found) return;
        setItems(next => {
            const arr = next.slice();
            arr.splice(found.idx + 1, 0, { type: "page", srcPage: found.page } as ManifestPageItem);
            return arr;
        });
    };

    const onDeletePage = (id: string) => {
        const found = pageThumbs.find(t => t.id === id);
        if (!found) return;
        setItems(next => {
            const arr = next.slice();
            if (arr[found.idx]?.type === "page") arr.splice(found.idx, 1);
            return arr;
        });
    };

    const onAddPage = () => {
        const maxPg = Math.max(0, ...items.filter(i => i.type === "page").map(i => (i as ManifestPageItem).srcPage));
        pushPage(maxPg + 1);
    };

    return (
        <div className="panel" style={{ padding: 16 }}>
            {/* 툴바 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>자료 편집</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={resetDefault} disabled={loading || !totalPages}>기본(1..N)으로</button>
                    <button className="btn btn-primary" onClick={save} disabled={loading}>저장</button>
                    <button className="btn" onClick={onClose}>닫기</button>
                </div>
            </div>

            {/* 채점 기본값 */}
            <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="badge">채점 기본값</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                            type="checkbox"
                            checked={defaults.enableSubstr}
                            onChange={(e) => setDefaults(d => ({ ...d, enableSubstr: e.target.checked }))}
                        /> 부분일치 허용
                    </label>
                    <label>최소 글자
                        <input
                            className="input" style={{ width: 70, marginLeft: 6 }}
                            type="number" min={1} value={defaults.minLen}
                            onChange={(e) => setDefaults(d => ({ ...d, minLen: Math.max(1, Number(e.target.value) || 1) }))}
                        />
                    </label>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>* “퀴즈 삽입” 시 적용됩니다.</div>
            </div>

            {/* 조작 버튼 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={onAddPage}>페이지 추가</button>
                <button className="btn" onClick={pushBlankPage}>빈 페이지 추가</button>{/* ✅ */}
                <button className="btn" onClick={pushQuiz}>퀴즈 삽입</button>
            </div>

            {/* 메인 리스트 */}
            <div style={{ display: "grid", gap: 8 }}>
                {items.map((it, i) => (
                    <div
                        key={i}
                        ref={(el) => { if (el) cardRefs.current.set(i, el); }}
                        className="card"
                        style={{
                            padding: 10,
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 8,
                            outline: highlightIdx === i ? "2px solid #22c55e" : "none",
                            transition: "outline-color .3s",
                        }}
                    >
                        <div>
                            {it.type === "page" ? (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span className="badge">PAGE</span>
                                    <label>
                                        srcPage:
                                        <input
                                            className="input" style={{ width: 90, marginLeft: 6 }}
                                            type="number" min={0}
                                            value={(it as ManifestPageItem).srcPage}
                                            onChange={(e) => {
                                                const v = Math.max(0, Number(e.target.value) || 0);
                                                setItems(arr => {
                                                    const next = arr.slice();
                                                    (next[i] as ManifestPageItem).srcPage = v;
                                                    return next;
                                                });
                                                onSelectPage?.(v); // ✅ 프리뷰 갱신
                                            }}
                                        />
                                    </label>
                                    <button className="btn" onClick={() => { onSelectPage?.((it as ManifestPageItem).srcPage); }}>
                                        이 페이지 미리보기
                                    </button>
                                </div>
                            ) : (
                                (() => {
                                    const q = it as QuizX;
                                    const mo: MatchOptions = q.matchOptions ?? (q.matchOptions = {});
                                    return (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                <span className="badge">QUIZ</span>
                                                <input
                                                    className="input" placeholder="프롬프트"
                                                    value={q.prompt}
                                                    onChange={(e) => setItems(arr => {
                                                        const next = arr.slice(); (next[i] as QuizX).prompt = e.target.value; return next;
                                                    })}
                                                />
                                                <label>임계:
                                                    <input
                                                        className="input" style={{ width: 70, marginLeft: 6 }}
                                                        type="number" min={1}
                                                        value={q.threshold ?? 1}
                                                        onChange={(e) => setItems(arr => {
                                                            const next = arr.slice(); (next[i] as QuizX).threshold = Math.max(1, Number(e.target.value) || 1); return next;
                                                        })}
                                                    />
                                                </label>
                                                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={q.autoAdvance ?? false}
                                                        onChange={(e) => setItems(arr => {
                                                            const next = arr.slice(); (next[i] as QuizX).autoAdvance = e.target.checked; return next;
                                                        })}
                                                    />
                                                    자동진행(권장안함)
                                                </label>
                                            </div>

                                            {/* 키워드 */}
                                            <div>
                                                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>정답 키워드(쉼표로 여러 개)</div>
                                                <input
                                                    className="input" placeholder="예) 에어컨, 선풍기, 냉방기"
                                                    value={(q.keywords || []).join(", ")}
                                                    onChange={(e) => setItems(arr => {
                                                        const next = arr.slice();
                                                        (next[i] as QuizX).keywords = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                                        return next;
                                                    })}
                                                />
                                            </div>

                                            {/* 매칭 옵션 */}
                                            <div className="panel" style={{ display: "grid", gap: 8 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                                    <span className="badge">매칭 옵션</span>
                                                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={!!mo.enableSubstr}
                                                            onChange={(e) => setItems(arr => {
                                                                const next = arr.slice();
                                                                const qq = next[i] as QuizX;
                                                                qq.matchOptions = { ...(qq.matchOptions ?? {}), enableSubstr: e.target.checked };
                                                                return next;
                                                            })}
                                                        />
                                                        부분일치 허용
                                                    </label>
                                                    <label>최소 글자
                                                        <input
                                                            className="input" style={{ width: 70, marginLeft: 6 }}
                                                            type="number" min={1}
                                                            value={mo.minLen ?? 2}
                                                            onChange={(e) => setItems(arr => {
                                                                const v = Math.max(1, Number(e.target.value) || 1);
                                                                const next = arr.slice(); const qq = next[i] as QuizX;
                                                                qq.matchOptions = { ...(qq.matchOptions ?? {}), minLen: v };
                                                                return next;
                                                            })}
                                                        />
                                                    </label>
                                                </div>

                                                {/* 붙일 페이지 선택 */}
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                    <span className="badge">배치</span>
                                                    <label>
                                                        붙일 페이지:&nbsp;
                                                        <select
                                                            className="input"
                                                            value={q.attachToSrcPage ?? 0}
                                                            onChange={(e) => {
                                                                const v = Math.max(0, Number(e.target.value) || 0);
                                                                setItems(arr => {
                                                                    const next = arr.slice();
                                                                    (next[i] as QuizX).attachToSrcPage = v;
                                                                    return next;
                                                                });
                                                                onSelectPage?.(v); // ✅ 프리뷰 갱신
                                                            }}
                                                        >
                                                            {pagesList.map((p) => (
                                                                <option key={`opt-${p}`} value={p}>
                                                                    {p === 0 ? "빈 화면(0)" : `p.${p}`}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <button className="btn" onClick={() => onSelectPage?.(q.attachToSrcPage ?? 0)}>
                                                        이 페이지 미리보기
                                                    </button>
                                                </div>

                                                {/* 동의어 테이블 */}
                                                <SynonymsEditor quiz={q} index={i} />
                                            </div>
                                        </div>
                                    );
                                })()
                            )}
                        </div>

                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button className="btn" onClick={() => move(i, -1)}>↑</button>
                            <button className="btn" onClick={() => move(i, 1)}>↓</button>
                            <button className="btn" onClick={() => duplicateAt(i)}>복제</button>
                            <button className="btn" onClick={() => removeAt(i)}>삭제</button>
                        </div>
                    </div>
                ))}
            </div>

            {/* 썸네일 스트립 */}
            <EditorThumbnailStrip
                fileUrl={fileUrl}
                items={pageThumbs.map(t => ({ id: t.id, page: t.page }))}
                onReorder={(next) => {
                    const remapped = next.map(n => {
                        const found = pageThumbs.find(t => t.page === n.page && t.id.startsWith("pg-"));
                        return found ?? { id: n.id, page: n.page, idx: -1 };
                    });
                    onReorderPages(remapped);
                }}
                onSelect={(id) => {
                    const found = pageThumbs.find(t => t.id === id);
                    if (found) {
                        scrollToIndex(found.idx);
                        onSelectPage?.(found.page); // ✅ 프리뷰 갱신
                    }
                }}
                onAdd={onAddPage}
                onDuplicate={onDuplicatePage}
                onDelete={onDeletePage}
            />
        </div>
    );
}
