// src/components/EditorPreviewPane.tsx
import React, { useMemo, useRef, useState } from "react";
import StaticPdfPage from "./StaticPdfPage";

type QuizLike = {
    prompt?: string;
    keywords?: string[];
    attachToSrcPage?: number;
    position?: "tl" | "tr" | "bl" | "br" | "free";
    posX?: number; // 0..1
    posY?: number; // 0..1
};

function styleFor(pos: QuizLike, container: HTMLDivElement | null) {
    const base: React.CSSProperties = {
        position: "absolute",
        background: "rgba(2, 6, 23, 0.75)",
        border: "1px solid rgba(148,163,184,0.35)",
        color: "white",
        borderRadius: 10,
        padding: "10px 12px",
        maxWidth: "min(680px, 95%)",
        backdropFilter: "blur(2px)",
    };
    const p = pos.position || "tl";
    if (p === "free") {
        const x = Math.max(0, Math.min(1, pos.posX ?? 0.05));
        const y = Math.max(0, Math.min(1, pos.posY ?? 0.05));
        return { ...base, left: `${x * 100}%`, top: `${y * 100}%` };
    }
    const map: Record<string, React.CSSProperties> = {
        tl: { left: 12, top: 12 },
        tr: { right: 12, top: 12 },
        bl: { left: 12, bottom: 12 },
        br: { right: 12, bottom: 12 },
    };
    return { ...base, ...map[p] };
}

export default function EditorPreviewPane({
                                              fileUrl, page, quizzes, height = "82vh", editable = false,
                                              onDragMove,
                                          }: {
    fileUrl: string | null | undefined;
    page: number;                 // 0 → 빈 화면
    quizzes: QuizLike[];
    height?: string;
    editable?: boolean;
    onDragMove?: (quizIndexInThisPage: number, pos: { x: number; y: number }) => void;
}) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [dragIdx, setDragIdx] = useState<number | null>(null);

    const normalized = useMemo(() => quizzes.map(q => ({
        ...q,
        position: q.position ?? "tl",
        posX: typeof q.posX === "number" ? q.posX : 0.05,
        posY: typeof q.posY === "number" ? q.posY : 0.05,
    })), [quizzes]);

    const onMouseDown = (e: React.MouseEvent, idx: number) => {
        if (!editable) return; setDragIdx(idx); e.preventDefault();
    };
    const onMouseMove = (e: React.MouseEvent) => {
        if (!editable || dragIdx === null) return;
        const host = hostRef.current; if (!host) return;
        const rect = host.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        onDragMove?.(dragIdx, { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    };
    const onMouseUp = () => setDragIdx(null);

    return (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge">프리뷰</span>
                <span>p.{page === 0 ? "빈 화면" : page}</span>
                {editable && <span style={{ marginLeft: 6, fontSize: 12, opacity: .75 }}>퀴즈 카드 드래그로 위치 이동</span>}
            </div>

            <div
                ref={hostRef}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                style={{ position: "relative" }}
            >
                {/* 본문: 정적 PDF 페이지만 렌더 (부작용 없음) */}
                {page > 0 && fileUrl ? (
                    <StaticPdfPage fileUrl={fileUrl} page={page} maxHeight={height} />
                ) : (
                    <div
                        style={{
                            height,
                            background: "repeating-linear-gradient(45deg, #0f172a, #0f172a 10px, #111827 10px, #111827 20px)",
                            border: "1px dashed #334155",
                            borderRadius: 12,
                            display: "grid",
                            placeItems: "center",
                            color: "#94a3b8",
                        }}
                    >
                        빈 페이지 (퀴즈만 표시)
                    </div>
                )}

                {/* 퀴즈 오버레이 */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    {normalized.map((q, idx) => (
                        <div
                            key={idx}
                            onMouseDown={(e) => onMouseDown(e, idx)}
                            style={{ ...styleFor(q, hostRef.current), pointerEvents: editable ? "auto" : "none", cursor: editable ? "move" : "default" }}
                        >
                            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>퀴즈</div>
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>{q.prompt || "(제목 없음)"}</div>
                            {q.keywords?.length ? <div style={{ fontSize: 12, opacity: 0.75 }}>키워드: {q.keywords.join(", ")}</div> : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
