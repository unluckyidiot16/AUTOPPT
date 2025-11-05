import React, { useEffect, useState } from "react";
import type { ManifestItem, ManifestPageItem, ManifestQuizItem } from "../types/manifest";
import { defaultManifest } from "../types/manifest";
import { getManifestByRoom, upsertManifest } from "../api/overrides";

export default function DeckEditor({
                                       roomCode, deckId, totalPages, onClose, onSaved,
                                   }: {
    roomCode: string; deckId: string; totalPages: number | null;
    onClose: () => void; onSaved?: () => void;
}) {
    const [items, setItems] = useState<ManifestItem[]>([]);
    const [loading, setLoading] = useState(true);
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
    const duplicateAt = (i: number) => setItems((arr) => [...arr.slice(0, i+1), arr[i], ...arr.slice(i+1)]);
    const pushPage = (srcPage: number) => setItems((arr) => [...arr, { type: "page", srcPage } as ManifestPageItem]);
    const pushQuiz = () => setItems((arr) => [
        ...arr, { type: "quiz", prompt: "문제를 입력하세요", keywords: [], threshold: 1, autoAdvance: false } as ManifestQuizItem
    ]);

    const save = async () => {
        await upsertManifest(roomCode, deckId, items);
        onSaved?.();
        onClose();
    };

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

                {loading ? <div>불러오는 중…</div> : (
                    <>
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <button className="btn" onClick={() => pushPage( (items.filter(i=>i.type==="page").length)+1 )}>페이지 추가</button>
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
                                            <div style={{ display: "grid", gap: 6 }}>
                                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <span className="badge">QUIZ</span>
                                                    <input
                                                        className="input" placeholder="프롬프트"
                                                        value={(it as ManifestQuizItem).prompt}
                                                        onChange={(e) => {
                                                            const next = items.slice();
                                                            (next[i] as ManifestQuizItem).prompt = e.target.value;
                                                            setItems(next);
                                                        }}
                                                    />
                                                    <label>
                                                        임계:
                                                        <input
                                                            className="input" style={{ width: 70, marginLeft: 6 }}
                                                            type="number" min={1}
                                                            value={(it as ManifestQuizItem).threshold ?? 1}
                                                            onChange={(e) => {
                                                                const next = items.slice();
                                                                (next[i] as ManifestQuizItem).threshold = Math.max(1, Number(e.target.value) || 1);
                                                                setItems(next);
                                                            }}
                                                        />
                                                    </label>
                                                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(it as ManifestQuizItem).autoAdvance ?? false}
                                                            onChange={(e) => {
                                                                const next = items.slice();
                                                                (next[i] as ManifestQuizItem).autoAdvance = e.target.checked;
                                                                setItems(next);
                                                            }}
                                                        />
                                                        자동진행(권장안함)
                                                    </label>
                                                </div>
                                                <input
                                                    className="input" placeholder="키워드(쉼표로 구분)"
                                                    value={(it as ManifestQuizItem).keywords.join(", ")}
                                                    onChange={(e) => {
                                                        const next = items.slice();
                                                        (next[i] as ManifestQuizItem).keywords =
                                                            e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                                        setItems(next);
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <button className="btn" onClick={() => move(i,-1)}>↑</button>
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
