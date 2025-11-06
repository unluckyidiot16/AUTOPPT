// src/components/EditorPreviewPane.tsx
import React from "react";
import PdfViewer from "./PdfViewer";
import type { ManifestQuizItem } from "../types/manifest";

export default function EditorPreviewPane({
                                              fileUrl,
                                              page,
                                              quizzes,
                                              height = "82vh",
                                          }: {
    fileUrl: string | null | undefined;
    page: number;                 // 0 → 빈 화면
    quizzes: ManifestQuizItem[];  // 해당 페이지에 붙은 퀴즈들
    height?: string;
}) {
    return (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge">프리뷰</span>
                <span>p.{page === 0 ? "빈 화면" : page}</span>
            </div>

            <div style={{ position: "relative" }}>
                {/* 페이지 본문 */}
                {page > 0 && fileUrl ? (
                    <PdfViewer fileUrl={fileUrl} page={page} maxHeight={height} />
                ) : (
                    <div
                        style={{
                            height,
                            background:
                                "repeating-linear-gradient(45deg, #0f172a, #0f172a 10px, #111827 10px, #111827 20px)",
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

                {/* 퀴즈 오버레이(미리보기용) */}
                {quizzes?.length > 0 && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            pointerEvents: "none",
                            display: "grid",
                            alignContent: "start",
                            gap: 8,
                            padding: 12,
                        }}
                    >
                        {quizzes.map((q, idx) => (
                            <div
                                key={idx}
                                style={{
                                    pointerEvents: "auto",
                                    background: "rgba(2, 6, 23, 0.75)",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    color: "white",
                                    borderRadius: 10,
                                    padding: "10px 12px",
                                    maxWidth: "min(680px, 95%)",
                                    backdropFilter: "blur(2px)",
                                }}
                            >
                                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>퀴즈</div>
                                <div style={{ fontWeight: 700, marginBottom: 8 }}>{q.prompt || "(제목 없음)"}</div>
                                {(q as any).keywords?.length ? (
                                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                                        키워드: {(q as any).keywords.join(", ")}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
