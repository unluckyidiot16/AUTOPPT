// src/components/EditorPreviewPane.tsx
import React from "react";
import StaticPdfPage from "../components/StaticPdfPage";

type Props = {
    fileUrl: string | null;
    page: number;
    style?: React.CSSProperties;
    // 에디터에서 추가로 넘기는 prop을 허용(타입 오류 예방)
    height?: number | string;
    quizzes?: any[];
    editable?: boolean;
    onDragMove?: (idx: number, pos: { x: number; y: number }) => void;
};

export default function EditorPreviewPane({ fileUrl, page, style, height }: Props) {
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: height ?? "calc(100vh - 160px)",
                minHeight: 380,
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,.18)",
                background: "rgba(2,6,23,.35)",
                padding: 16,
                overflow: "auto",
                ...style,
            }}
        >
            {!fileUrl ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        color: "#ef4444",
                    }}
                >
                    deck file not found
                </div>
            ) : (
                <div style={{ width: "100%", maxWidth: 980, margin: "0 auto" }}>
                    {/* 페이지/URL 변경 시 완전 재마운트 → 꼬임 방지 */}
                    <StaticPdfPage key={`${fileUrl}|p-${page}`} fileUrl={fileUrl} page={page} fit="width" />
                </div>
            )}
        </div>
    );
}
