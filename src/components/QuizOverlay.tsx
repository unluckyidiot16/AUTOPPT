// src/components/QuizOverlay.tsx
import React, { useMemo, useState } from "react";
import type { ManifestQuizItem, QuizQuestion } from "../types/manifest";
import { gradeKeywords } from "../utils/textNorm";

export default function QuizOverlay({
                                        item,
                                        mode = "student",
                                        onPassed,
                                    }: {
    item: ManifestQuizItem | any;          // v1/overlay payload 혼재 대응
    mode?: "student" | "teacher";
    onPassed?: () => void;
}) {
    // v2(questions[]), v1(prompt/keywords) 모두 수용
    const questions: QuizQuestion[] = useMemo(() => {
        if (Array.isArray(item?.questions) && item.questions.length) return item.questions as QuizQuestion[];
        // v1 호환(단일 문항 평탄화)
        const prompt = item?.prompt ?? item?.payload?.prompt ?? "";
        const keywords = item?.keywords ?? item?.payload?.keywords ?? [];
        const threshold = item?.threshold ?? item?.payload?.threshold;
        return [{ id: item?.id ?? "q1", prompt, keywords, threshold }];
    }, [item]);

    const [qIndex, setQIndex] = useState(0);
    const q = questions[Math.min(Math.max(0, qIndex), questions.length - 1)];

    const [val, setVal] = useState("");
    const [res, setRes] = useState<{ passed: boolean; hits: number; missing: string[] } | null>(null);

    const threshold = q?.threshold ?? item?.threshold ?? item?.payload?.threshold ?? 1;
    const bg = item?.bg ?? item?.payload?.bg ?? "rgba(17,24,39,.85)";
    const fg = item?.fg ?? item?.payload?.fg ?? "#fff";

    const shellStyle: React.CSSProperties = {
        position: "relative",
        display: "grid",
        gap: 8,
        padding: 16,
        background: bg,
        color: fg,
        borderRadius: 12,
    };

    if (mode === "teacher") {
        return (
            <div style={{ ...shellStyle, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    퀴즈(프리뷰) · 문항 {qIndex + 1}/{questions.length}
                </div>
                <div style={{ marginBottom: 8 }}>{q?.prompt || "(문항 없음)"}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                    키워드: {(q?.keywords ?? []).join(", ")} · 임계: {threshold}
                </div>
                {questions.length > 1 && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button className="btn" onClick={() => setQIndex((i) => Math.max(0, i - 1))}>이전</button>
                        <button className="btn" onClick={() => setQIndex((i) => Math.min(questions.length - 1, i + 1))}>다음</button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={shellStyle}>
            <div style={{ fontWeight: 700 }}>{q?.prompt || "(문항 없음)"}</div>

            <input
                className="input"
                placeholder="정답을 입력하세요"
                value={val}
                onChange={(e) => setVal(e.target.value)}
            />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        const g = gradeKeywords(val, q?.keywords ?? [], threshold);
                        setRes(g);
                        if (g.passed) onPassed?.();
                    }}
                >
                    제출
                </button>

                {res && (
                    <span>
            {res.passed ? "통과!" : `부족: ${res.missing.join(", ")}`}
          </span>
                )}

                {questions.length > 1 && (
                    <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
            문항 {qIndex + 1}/{questions.length}
          </span>
                )}
            </div>

            {questions.length > 1 && (
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={() => setQIndex((i) => Math.max(0, i - 1))}>이전</button>
                    <button className="btn" onClick={() => setQIndex((i) => Math.min(questions.length - 1, i + 1))}>다음</button>
                </div>
            )}

            <div style={{ fontSize: 12, opacity: 0.75 }}>
                ※ 통과 후에는 교사의 “다음” 전환을 기다려주세요.
            </div>
        </div>
    );
}
