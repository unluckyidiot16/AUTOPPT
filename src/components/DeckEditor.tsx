import React, { useEffect, useMemo, useState } from "react";
import type { ManifestItem, ManifestPageItem, ManifestQuizItem } from "../types/manifest";
import { defaultManifest } from "../types/manifest";
import { getManifestByRoom, upsertManifest } from "../api/overrides";

/** ─────────────────────────────────────────────────────────────────────
 *  koNormalize v2 매칭 옵션(선택 필드)
 *  ManifestQuizItem에 부가로 저장해도 기존 렌더에는 영향 없음
 *  ───────────────────────────────────────────────────────────────────── */
type MatchOptions = {
    enableSubstr?: boolean;                    // 부분일치 허용
    minLen?: number;                           // 부분일치 최소 길이
    synonyms?: Record<string, string[]>;       // 동의어 테이블
};
type QuizX = ManifestQuizItem & { matchOptions?: MatchOptions };

const LS_KEY = "autoppt:matchDefaults";

function loadMatchDefaults(): Required<MatchOptions> {
    try {
        const j = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
        return {
            enableSubstr: j.enableSubstr ?? true,
            minLen: Math.max(2, Number(j.minLen ?? 2)),
            synonyms: (j.synonyms && typeof j.synonyms === "object") ? j.synonyms : {},
        };
    } catch {
        return { enableSubstr: true, minLen: 2, synonyms: {} };
    }
}
function saveMatchDefaults(v: Required<MatchOptions>) {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
}

/** 간단한 동의어 에디터 행 */
function SynRow({
                    base, syns, onChange, onRemove,
                }: {
    base: string; syns: string[];
    onChange: (nextBase: string, nextSyns: string[]) => void;
    onRemove: () => void;
}) {
    const [b, setB] = useState(base);
    const [t, setT] = useState(syns.join(", "));
    useEffect(() => { setB(base); setT(syns.join(", ")); }, [base, syns]);

    return (
        <div style={{
            display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 6, alignItems: "center",
            border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8, padding: 6
        }}>
            <input className="input" value={b} placeholder="기준어"
                   onChange={(e) => setB(e.target.value)} />
            <input className="input" value={t} placeholder="동의어들을 쉼표로 구분"
                   onChange={(e) => setT(e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
                <button className="btn"
                        onClick={() => onChange(b.trim(), t.split(",").map(s => s.trim()).filter(Boolean))}>
                    적용
                </button>
                <button className="btn" onClick={onRemove}>삭제</button>
            </div>
        </div>
    );
}

export default function DeckEditor({
                                       roomCode, deckId, totalPages, onClose, onSaved,
                                   }: {
    roomCode: string; deckId: string; totalPages: number | null;
    onClose: () => void; onSaved?: () => void;
}) {
    const [items, setItems] = useState<ManifestItem[]>([]);
    const [loading, setLoading] = useState(true);

    // 전역 기본값(퀴즈 삽입 시 초기화에 사용, LS에 보관)
    const [defaults, setDefaults] = useState<Required<MatchOptions>>(() => loadMatchDefaults());
    useEffect(() => { saveMatchDefaults(defaults); }, [defaults]);

    const resetDefault = () => setItems(defaultManifest(totalPages ?? 0));

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const m = await getManifestByRoom(roomCode);
                if (m.length) setItems(m);
                else resetDefault();
            } finally {
                setLoading(false);
            }
        })();
    }, [roomCode, totalPages]);

    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = items.slice();
        const t = next[i]; next[i] = next[j]; next[j] = t;
        setItems(next);
    };
    const removeAt = (i: number) => setItems(items.filter((_, k) => k !== i));
    const duplicateAt = (i: number) => setItems((arr) => [...arr.slice(0, i + 1), arr[i], ...arr.slice(i + 1)]);
    const pushPage = (srcPage: number) => setItems((arr) => [...arr, { type: "page", srcPage } as ManifestPageItem]);
    const pushQuiz = () => setItems((arr) => [
        ...arr,
        {
            type: "quiz",
            prompt: "문제를 입력하세요",
            keywords: [],
            threshold: 1,
            autoAdvance: false,
            matchOptions: {
                enableSubstr: defaults.enableSubstr,
                minLen: defaults.minLen,
                synonyms: { ...defaults.synonyms },
            },
        } as QuizX
    ]);

    const save = async () => {
        await upsertManifest(roomCode, deckId, items);
        onSaved?.();
        onClose();
    };

    /** 동의어 편집기: quiz.matchOptions.synonyms 를 레코드로 관리 */
    function SynonymsEditor({
                                quiz, index,
                            }: { quiz: QuizX; index: number }) {
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
                    <SynRow
                        key={base}
                        base={base}
                        syns={syns}
                        onChange={(nb, ns) => updateMap(cur => {
                            const copy = { ...cur };
                            if (base !== nb) delete copy[base];
                            if (nb) copy[nb] = ns;
                            return copy;
                        })}
                        onRemove={() => updateMap(cur => {
                            const copy = { ...cur }; delete copy[base]; return copy;
                        })}
                    />
                ))}

                <div style={{ display: "flex", gap: 6 }}>
                    <button
                        className="btn"
                        onClick={() => updateMap(cur => ({ ...cur, "": [] }))}
                    >
                        + 행 추가
                    </button>
                    <button className="btn"
                            onClick={() => updateMap(() => ({}))}
                    >
                        전체 삭제
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 80 }}>
            <div className="panel" style={{ width: "min(96vw, 980px)", maxHeight: "90vh", overflow: "auto", padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontWeight: 700 }}>자료 편집</div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button className="btn" onClick={resetDefault} disabled={loading || !totalPages}>기본(1..N)으로</button>
                        <button className="btn btn-primary" onClick={save} disabled={loading}>저장</button>
                        <button className="btn" onClick={onClose}>닫기</button>
                    </div>
                </div>

                {/* 전역 기본값 (퀴즈 삽입 시 적용) */}
                <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span className="badge">채점 기본값</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                                type="checkbox"
                                checked={defaults.enableSubstr}
                                onChange={(e) => setDefaults(d => ({ ...d, enableSubstr: e.target.checked }))}
                            />
                            부분일치 허용
                        </label>
                        <label>
                            최소 글자
                            <input
                                className="input" style={{ width: 70, marginLeft: 6 }}
                                type="number" min={1}
                                value={defaults.minLen}
                                onChange={(e) => setDefaults(d => ({ ...d, minLen: Math.max(1, Number(e.target.value) || 1) }))}
                            />
                        </label>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                        * “퀴즈 삽입” 시 적용됩니다. 변경 사항은 브라우저에 기억됩니다.
                    </div>
                </div>

                {loading ? <div>불러오는 중…</div> : (
                    <>
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <button className="btn" onClick={() => pushPage((items.filter(i => i.type === "page").length) + 1)}>페이지 추가</button>
                            <button className="btn" onClick={pushQuiz}>퀴즈 삽입</button>
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                            {items.map((it, i) => (
                                <div key={i} className="card" style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                                    <div>
                                        {it.type === "page" ? (
                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <span className="badge">PAGE</span>
                                                <label>
                                                    srcPage:
                                                    <input
                                                        className="input" style={{ width: 90, marginLeft: 6 }}
                                                        type="number" min={1} value={(it as ManifestPageItem).srcPage}
                                                        onChange={(e) => {
                                                            const v = Math.max(1, Number(e.target.value) || 1);
                                                            const next = items.slice();
                                                            (next[i] as ManifestPageItem).srcPage = v;
                                                            setItems(next);
                                                        }}
                                                    />
                                                </label>
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
                                                                onChange={(e) => {
                                                                    const next = items.slice();
                                                                    (next[i] as QuizX).prompt = e.target.value;
                                                                    setItems(next);
                                                                }}
                                                            />
                                                            <label>
                                                                임계:
                                                                <input
                                                                    className="input" style={{ width: 70, marginLeft: 6 }}
                                                                    type="number" min={1}
                                                                    value={q.threshold ?? 1}
                                                                    onChange={(e) => {
                                                                        const next = items.slice();
                                                                        (next[i] as QuizX).threshold = Math.max(1, Number(e.target.value) || 1);
                                                                        setItems(next);
                                                                    }}
                                                                />
                                                            </label>
                                                            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={q.autoAdvance ?? false}
                                                                    onChange={(e) => {
                                                                        const next = items.slice();
                                                                        (next[i] as QuizX).autoAdvance = e.target.checked;
                                                                        setItems(next);
                                                                    }}
                                                                />
                                                                자동진행(권장안함)
                                                            </label>
                                                        </div>

                                                        {/* 키워드 복수 입력 (쉼표 구분) */}
                                                        <div>
                                                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>정답 키워드(쉼표로 여러 개)</div>
                                                            <input
                                                                className="input" placeholder="예) 에어컨, 선풍기, 냉방기"
                                                                value={(q.keywords || []).join(", ")}
                                                                onChange={(e) => {
                                                                    const next = items.slice();
                                                                    (next[i] as QuizX).keywords =
                                                                        e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                                                    setItems(next);
                                                                }}
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
                                                                        onChange={(e) => {
                                                                            const next = items.slice();
                                                                            const qq = next[i] as QuizX;
                                                                            qq.matchOptions = { ...(qq.matchOptions ?? {}), enableSubstr: e.target.checked };
                                                                            setItems(next);
                                                                        }}
                                                                    />
                                                                    부분일치 허용
                                                                </label>
                                                                <label>
                                                                    최소 글자
                                                                    <input
                                                                        className="input" style={{ width: 70, marginLeft: 6 }}
                                                                        type="number" min={1}
                                                                        value={mo.minLen ?? 2}
                                                                        onChange={(e) => {
                                                                            const v = Math.max(1, Number(e.target.value) || 1);
                                                                            const next = items.slice();
                                                                            const qq = next[i] as QuizX;
                                                                            qq.matchOptions = { ...(qq.matchOptions ?? {}), minLen: v };
                                                                            setItems(next);
                                                                        }}
                                                                    />
                                                                </label>
                                                            </div>

                                                            {/* 동의어 편집기 */}
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
                    </>
                )}
            </div>
        </div>
    );
}
