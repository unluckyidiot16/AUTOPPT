import React, { useState } from "react";
import type { ManifestQuizItem } from "../types/manifest";
import { gradeKeywords } from "../utils/textNorm";

export default function QuizOverlay({
                                        item,
                                        mode = "student", // "student" | "teacher"
                                        onPassed,
                                    }: {
    item: ManifestQuizItem;
    mode?: "student" | "teacher";
    onPassed?: () => void;
}) {
    const [val, setVal] = useState("");
    const [res, setRes] = useState<{ passed: boolean; hits: number; missing: string[] } | null>(null);

    if (mode === "teacher") {
        return (
            <div style={{ padding: 16, background: "rgba(0,0,0,.5)", color: "#fff", borderRadius: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>퀴즈(프리뷰)</div>
                <div style={{ marginBottom: 8 }}>{item.prompt}</div>
                <div style={{ fontSize: 12, opacity: .8 }}>키워드: {item.keywords.join(", ")} · 임계: {item.threshold ?? 1}</div>
            </div>
        );
    }

    return (
        <div style={{
            position: "relative", display: "grid", gap: 8, padding: 16,
            background: "rgba(17,24,39,.85)", color: "#fff", borderRadius: 12
        }}>
            <div style={{ fontWeight: 700 }}>{item.prompt}</div>
            <input
                className="input"
                placeholder="정답을 입력하세요"
                value={val}
                onChange={(e) => setVal(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        const g = gradeKeywords(val, item.keywords, item.threshold ?? 1);
                        setRes(g);
                        if (g.passed) onPassed?.();
                    }}
                >
                    제출
                </button>
                {res && (
                    <span style={{ alignSelf: "center" }}>
            {res.passed ? "통과!" : `부족: ${res.missing.join(", ")}`}
          </span>
                )}
            </div>
            <div style={{ fontSize: 12, opacity: .75 }}>
                ※ 통과 후에는 교사의 “다음” 전환을 기다려주세요.
            </div>
        </div>
    );
}
