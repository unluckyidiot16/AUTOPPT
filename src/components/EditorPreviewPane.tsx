// src/components/EditorPreviewPane.tsx (드롭-인 교체)
import React from "react";
import StaticPdfPage from "../components/StaticPdfPage";

export default function EditorPreviewPane({
                                              fileUrl,
                                              page,
                                              style,
                                          }: {
    fileUrl: string | null;
    page: number;
    style?: React.CSSProperties;
}) {
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "calc(100vh - 160px)",
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
                    {/* 페이지/URL이 바뀔 때 완전 재마운트 → 렌더 꼬임 방지 */}
                    <StaticPdfPage key={`${fileUrl}|p-${page}`} fileUrl={fileUrl} page={page} fit="width" />
                </div>
            )}
        </div>
    );
}
