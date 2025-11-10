// src/components/DeckEditor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ManifestItem, ManifestPageItem, ManifestQuizItem } from "../types/manifest";
import { getManifestByRoom, upsertManifest } from "../api/overrides";
import EditorThumbnailStrip from "./EditorThumbnailStrip";
import { finalizeTempDeck } from "../utils/tempDeck";

type MatchOptions = {
    enableSubstr?: boolean;
    minLen?: number;
    useSynonyms?: boolean;
    synonyms?: Record<string, string[]>;
};
type QuizX = ManifestQuizItem & {
    matchOptions?: MatchOptions;
    attachToSrcPage?: number;
    position?: "tl" | "tr" | "bl" | "br" | "free";
    posX?: number; posY?: number;
};

function ensureManifestPages(totalPages: number): ManifestPageItem[] {
    const n = Math.max(0, Number(totalPages) || 0);
    return Array.from({ length: n }, (_, i) => ({ type: "page", srcPage: i + 1 }));
}

const makePageItem = (srcPage: number) =>
    ({ type: "page", kind: "page", srcPage } as ManifestPageItem);

export default function DeckEditor({
                                       roomCode, deckId, totalPages, fileKey, onClose, onSaved,
                                       onItemsChange, onSelectPage, applyPatchRef, tempCleanup,
                                       enableRealtime = false,
                                   }: {
    roomCode: string; deckId: string; totalPages: number | null; fileKey?: string | null;
    onClose: () => void; onSaved?: () => void;
    onItemsChange?: (items: ManifestItem[]) => void;
    onSelectPage?: (srcPage: number) => void;
    applyPatchRef?: React.MutableRefObject<((fn: (cur: ManifestItem[]) => ManifestItem[]) => void) | null>;
    tempCleanup?: { roomId: string; deleteDeckRow?: boolean };
    enableRealtime?: boolean;
}) {
    const [items, _setItems] = useState<ManifestItem[]>([]);
    const [loading, setLoading] = useState(true);


    const [targetPage, setTargetPage] = useState<number>((totalPages ?? 0) > 0 ? 1 : 0);
    useEffect(() => { setTargetPage((totalPages ?? 0) > 0 ? 1 : 0); }, [totalPages]);
    
    const setItems = (updater: ManifestItem[] | ((prev: ManifestItem[]) => ManifestItem[])) => {
        _setItems(prev => {
            const next = typeof updater === "function" ? (updater as any)(prev) : updater;
            try { onItemsChange?.(next); } catch {}
            return next;
        });
    };

    // 기본 매칭값(로컬 저장)
    const LS_KEY = "autoppt:matchDefaults";
    const [defaults, setDefaults] = useState<Required<Omit<MatchOptions, "synonyms">> & { synonyms: Record<string, string[]> }>(() => {
        try {
            const j = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
            return {
                enableSubstr: j.enableSubstr ?? true,
                minLen: Math.max(2, Number(j.minLen ?? 2)),
                useSynonyms: j.useSynonyms ?? false,
                synonyms: (j.synonyms && typeof j.synonyms === "object") ? j.synonyms : {},
            };
        } catch { return { enableSubstr: true, minLen: 2, useSynonyms: false, synonyms: {} }; }
    });
    useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(defaults)); }, [defaults]);

    const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const [highlightIdx, setHighlightIdx] = useState<number | null>(null);


    // 외부 패치(프리뷰 드래그 등) 연결
    useEffect(() => {
        if (!applyPatchRef) return;

        // 부모가 넘겨준 패치 함수를 에디터의 setItems와 연결
        applyPatchRef.current = (fn) => {
            setItems((cur) => {
                const next = fn(cur);
                onItemsChange?.(next);    // 부모에도 동기화
                return next;
            });
        };

        return () => {
            if (applyPatchRef) applyPatchRef.current = null;
        };
    }, [applyPatchRef, setItems, onItemsChange]);
    
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                let next: ManifestItem[] = [];
                                if (roomCode) {
                                        try {
                                                const m = await getManifestByRoom(roomCode);
                                                next = Array.isArray(m) ? m : (Array.isArray((m as any)?.items) ? (m as any).items : []);
                                            } catch {}
                                    }
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
    }, [roomCode, totalPages, enableRealtime]);


    const addPageFromSrc = (srcPage: number) => {
        setItems((cur) => {
            const next = [...cur, { type: "page", kind: "page", srcPage } as any];
            onItemsChange?.(next);
            onSelectPage?.(Math.max(1, next.filter((i: any) => i.type === "page").length)); // 마지막 페이지로 포커스
            return next;
        });
    };
    //    - 빈 페이지 추가: srcPage:0 로 메타 반영(프리뷰는 빈 캔버스)
    const addBlankPageLocal = () => addPageFromSrc(0);

    //    - 퀴즈 삽입: 현재 선택 페이지 p에 정규화 좌표로 박스 추가
    const insertQuizAt = (p: number) => {
        setItems((cur) => {
            const next = [
                ...cur,
                {
                    type: "quiz",
                    srcPage: p,      // ← 프리뷰 매핑과 동일한 키 사용
                    x: 0.1, y: 0.1, w: 0.3, h: 0.2,
                    question: "",
                    answer: "",
                } as any,
            ];
            onItemsChange?.(next);
            return next;
        });
    };
    
    const resetDefault = () => {
        if (!totalPages) return;
        const pages = ensureManifestPages(totalPages);
        const quizzes = items.filter(it => it.type !== "page");
        setItems([...pages, ...quizzes]);
    };

    const move = (i: number, d: number) => {
        const j = i + d; if (j < 0 || j >= items.length) return;
        setItems(arr => { const next = arr.slice(); const t = next[i]; next[i] = next[j]; next[j] = t; return next; });
    };
    const removeAt = (i: number) => setItems(items.filter((_, k) => k !== i));
    const duplicateAt = (i: number) => setItems((arr) => [...arr.slice(0, i + 1), arr[i], ...arr.slice(i + 1)]);
    const pushPage = (srcPage: number) =>
        setItems(arr => [...arr, makePageItem(srcPage)]);
    const pushBlankPage = () => {
          setItems(arr => [...arr, makePageItem(0)]);
          setTargetPage(0); onSelectPage?.(0);
        };
    
    const pushQuiz = () => setItems((arr) => [...arr, {
        type: "quiz",
            // 프리뷰가 즉시 보이도록 현재 타겟 페이지에 붙입니다.
        srcPage: targetPage,
        attachToSrcPage: targetPage,
        prompt: "문제를 입력하세요", keywords: [],
        threshold: 1, autoAdvance: false,
        matchOptions: {
            enableSubstr: defaults.enableSubstr,
            minLen: defaults.minLen,
            useSynonyms: defaults.useSynonyms,
            synonyms: { ...defaults.synonyms },
        },
        position: "tl",
    } as QuizX]);

    const [saving, setSaving] = useState(false);
    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await upsertManifest(roomCode, deckId, items);
            if (tempCleanup?.roomId) {
                try {
                    await finalizeTempDeck({ roomId: tempCleanup.roomId, deckId, deleteDeckRow: tempCleanup.deleteDeckRow ?? true });
                } catch (e) { console.warn("[finalizeTempDeck] cleanup failed", e); }
            }
            if (onSaved) onSaved(); else onClose();
        } catch (e) {
            console.error("[DeckEditor.save] failed", e);
            alert("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        } finally {
            setSaving(false);
        }
    };

    function SynonymsEditor({ quiz, index }: { quiz: QuizX; index: number }) {
        const enabled = !!quiz.matchOptions?.useSynonyms;
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
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 700 }}>동의어</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setItems(prev => {
                                const next = prev.slice();
                                const q = (next[index] as QuizX);
                                const mo = q.matchOptions ?? (q.matchOptions = {});
                                mo.useSynonyms = e.target.checked;
                                return next;
                            })}
                        /> 동의어 사용
                    </label>
                </div>

                {!enabled ? (
                    <div style={{ fontSize: 12, opacity: .65 }}>※ 체크 시 동의어 테이블 편집이 열립니다.</div>
                ) : (
                    <>
                        {entries.length === 0 && <div style={{ opacity: .6 }}>등록된 동의어가 없습니다.</div>}
                        {entries.map(([base, syns]) => (
                            <div key={base} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 6, alignItems: "center",
                                border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8, padding: 6 }}>
                                <input className="input" defaultValue={base} placeholder="기준어"
                                       onBlur={(e) => {
                                           const nb = e.target.value.trim();
                                           updateMap(cur => { const copy = { ...cur }; const old = copy[base] ?? []; delete copy[base]; if (nb) copy[nb] = old; return copy; });
                                       }} />
                                <input className="input" defaultValue={syns.join(", ")} placeholder="동의어(쉼표)"
                                       onBlur={(e) => { const ns = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                           updateMap(cur => ({ ...cur, [base]: ns })); }} />
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button className="btn" onClick={() => updateMap(cur => ({ ...cur, "": [] }))}>+ 행</button>
                                    <button className="btn" onClick={() => updateMap(cur => { const c = { ...cur }; delete c[base]; return c; })}>삭제</button>
                                </div>
                            </div>
                        ))}
                        {entries.length === 0 && (<button className="btn" onClick={() => updateMap(cur => ({ ...cur, "": [] }))}>+ 행 추가</button>)}
                    </>
                )}
            </div>
        );
    }

    // 썸네일/페이지 목록 유틸
    const pageThumbs = useMemo(() => {
        const arr: { id: string; page: number; idx: number }[] = [];
        items.forEach((it, idx) => { if (it.type === "page") arr.push({ id: `pg-${idx}-${(it as any).srcPage}`, page: (it as any).srcPage, idx }); });
        return arr;
    }, [items]);

    const pagesList = useMemo(() => {
        const pgs = [0, ...items.filter(i => i.type === "page").map(i => (i as ManifestPageItem).srcPage)]
            .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
        return pgs;
    }, [items]);

    const scrollToIndex = (i: number) => {
        const el = cardRefs.current.get(i);
        if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); setHighlightIdx(i); setTimeout(() => setHighlightIdx(null), 800); }
    };

    // 페이지 재정렬(썸네일 스트립에서 호출)
    const onReorderPages = (nextThumbs: { id: string; page: number; idx: number }[]) => {
        const orderedPages = nextThumbs.map(t => ({ type: "page", srcPage: t.page } as ManifestPageItem));
        let ptr = 0;
        setItems(items.map(it => (it.type === "page" ? (orderedPages[ptr++] ?? it) : it)));
    };

    // 썸네일 선택 → 해당 항목으로 스크롤 & 프리뷰 페이지 동기화
    const onSelectThumb = (id: string) => {
        const found = pageThumbs.find(t => t.id === id);
        if (!found) return;
        scrollToIndex(found.idx);
        setTargetPage(found.page); onSelectPage?.(found.page);
    };

    const onDuplicatePage = (id: string) => {
        const found = pageThumbs.find(t => t.id === id); if (!found) return;
        setItems(next => { const arr = next.slice(); arr.splice(found.idx + 1, 0, { type: "page", srcPage: found.page } as ManifestPageItem); return arr; });
    };
    const onDeletePage = (id: string) => {
        const found = pageThumbs.find(t => t.id === id); if (!found) return;
        setItems(next => { const arr = next.slice(); if (arr[found.idx]?.type === "page") arr.splice(found.idx, 1); return arr; });
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
                    <button className="btn btn-primary" onClick={save} disabled={loading || saving}>{saving ? "저장 중…" : "저장"}</button>
                    <button className="btn" onClick={onClose}>닫기</button>
                </div>
            </div>

            {/* 채점 기본값 */}
            <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="badge">채점 기본값</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={defaults.enableSubstr}
                               onChange={(e) => setDefaults(d => ({ ...d, enableSubstr: e.target.checked }))} /> 부분일치 허용
                    </label>
                    <label>최소 글자
                        <input className="input" style={{ width: 70, marginLeft: 6 }}
                               type="number" min={1} value={defaults.minLen}
                               onChange={(e) => setDefaults(d => ({ ...d, minLen: Math.max(1, Number(e.target.value) || 1) }))} />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={defaults.useSynonyms}
                               onChange={(e) => setDefaults(d => ({ ...d, useSynonyms: e.target.checked }))} /> 동의어 사용(기본값)
                    </label>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>* “퀴즈 삽입” 시 적용됩니다.</div>
            </div>

            {/* 조작 버튼 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={onAddPage}>페이지 추가</button>
                <button className="btn" onClick={pushBlankPage}>빈 페이지 추가</button>
                <button className="btn" onClick={pushQuiz}>퀴즈 삽입</button>
            </div>

            {/* 메인 리스트 */}
            <div style={{ display: "grid", gap: 8 }}>
                {items.map((it, i) => (
                    <div key={i} ref={(el) => { if (el) cardRefs.current.set(i, el); }}
                         className="card"
                         style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: 8,
                             outline: highlightIdx === i ? "2px solid #22c55e" : "none", transition: "outline-color .3s" }}>
                        <div>
                            {it.type === "page" ? (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span className="badge">PAGE</span>
                                    <label>srcPage:
                                        <input className="input" style={{ width: 90, marginLeft: 6 }} type="number" min={0}
                                               value={(it as ManifestPageItem).srcPage}
                                               onChange={(e) => {
                                                   const v = Math.max(0, Number(e.target.value) || 0);
                                                   setItems(arr => {
                                                                     const next = arr.slice();
                                                                     const qq = next[i] as QuizX;
                                                                     qq.attachToSrcPage = v;
                                                                     (qq as any).srcPage = v;        // ★ 프리뷰 매핑과 동기화
                                                                     return next;
                                                                   });
                                               }} />
                                    </label>
                                    <button className="btn" onClick={() => { const p = q.attachToSrcPage ?? 0; setTargetPage(p); onSelectPage?.(p); }}>
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
                                                <input className="input" placeholder="프롬프트"
                                                       value={q.prompt}
                                                       onChange={(e) => setItems(arr => { const next = arr.slice(); (next[i] as QuizX).prompt = e.target.value; return next; })} />
                                                <label>임계:
                                                    <input className="input" style={{ width: 70, marginLeft: 6 }} type="number" min={1}
                                                           value={q.threshold ?? 1}
                                                           onChange={(e) => setItems(arr => { const next = arr.slice(); (next[i] as QuizX).threshold = Math.max(1, Number(e.target.value) || 1); return next; })} />
                                                </label>
                                                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                    <input type="checkbox" checked={q.autoAdvance ?? false}
                                                           onChange={(e) => setItems(arr => { const next = arr.slice(); (next[i] as QuizX).autoAdvance = e.target.checked; return next; })} />
                                                    자동진행(권장안함)
                                                </label>
                                            </div>

                                            {/* 키워드 */}
                                            <div>
                                                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>정답 키워드(쉼표로 여러 개)</div>
                                                <input className="input" placeholder="예) 에어컨, 선풍기, 냉방기"
                                                       value={(q.keywords || []).join(", ")}
                                                       onChange={(e) => setItems(arr => {
                                                           const next = arr.slice();
                                                           (next[i] as QuizX).keywords = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                                           return next;
                                                       })} />
                                            </div>

                                            {/* 매칭 옵션 */}
                                            <div className="panel" style={{ display: "grid", gap: 8 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                                    <span className="badge">매칭 옵션</span>
                                                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <input type="checkbox" checked={!!mo.enableSubstr}
                                                               onChange={(e) => setItems(arr => { const next = arr.slice(); const qq = next[i] as QuizX;
                                                                   qq.matchOptions = { ...(qq.matchOptions ?? {}), enableSubstr: e.target.checked }; return next; })} />
                                                        부분일치 허용
                                                    </label>
                                                    <label>최소 글자
                                                        <input className="input" style={{ width: 70, marginLeft: 6 }} type="number" min={1}
                                                               value={mo.minLen ?? 2}
                                                               onChange={(e) => setItems(arr => { const v = Math.max(1, Number(e.target.value) || 1);
                                                                   const next = arr.slice(); const qq = next[i] as QuizX;
                                                                   qq.matchOptions = { ...(qq.matchOptions ?? {}), minLen: v }; return next; })} />
                                                    </label>
                                                </div>
                                                <SynonymsEditor quiz={q} index={i} />
                                            </div>

                                            {/* 배치 옵션 */}
                                            <div className="panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                                <span className="badge">배치</span>
                                                <label>
                                                    붙일 페이지:&nbsp;
                                                    <select className="input" value={q.attachToSrcPage ?? 0}
                                                            onChange={(e) => {
                                                                const v = Math.max(0, Number(e.target.value) || 0);
                                                                setItems(arr => { const next = arr.slice(); (next[i] as QuizX).attachToSrcPage = v; return next; });
                                                            }}>
                                                        {pagesList.map((p) => (<option key={`opt-${p}`} value={p}>{p === 0 ? "빈 화면(0)" : `p.${p}`}</option>))}
                                                    </select>
                                                </label>
                                                <label>
                                                    위치:&nbsp;
                                                    <select className="input" value={q.position ?? "tl"}
                                                            onChange={(e) => setItems(arr => { const next = arr.slice(); (next[i] as QuizX).position = (e.target.value as any); return next; })}>
                                                        <option value="tl">좌상단</option>
                                                        <option value="tr">우상단</option>
                                                        <option value="bl">좌하단</option>
                                                        <option value="br">우하단</option>
                                                        <option value="free">자유배치(드래그)</option>
                                                    </select>
                                                </label>
                                                <button className="btn" onClick={() => { const p = q.attachToSrcPage ?? 0; setTargetPage(p); onSelectPage?.(p); }}>
                                                      이 페이지 미리보기
                                                    </button>                                   
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
                fileKey={fileKey ?? null}
                items={pageThumbs.map(t => ({ id: t.id, page: t.page }))}
                onReorder={onReorderPages}
                onSelect={onSelectThumb}
                onAdd={onAddPage}
                onDuplicate={onDuplicatePage}
                onDelete={onDeletePage}
                // ▼ 가로 스트립 + 고정 높이(스크롤)
                orientation="horizontal"
                maxExtent={height /* 또는 136 같은 고정 px 값 */ ?? 136}
            />
        </div>
    );
}
