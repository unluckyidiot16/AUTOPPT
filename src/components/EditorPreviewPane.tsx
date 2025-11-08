// src/components/EditorPreviewPane.tsx
import React from "react";
import WebpSlide from "./WebpSlide";

type Props = {
    fileKey: string | null; // PDF key (images는 key의 prefix로 추적)
    page: number;
    style?: React.CSSProperties;
    height?: number | string;
};

export default function EditorPreviewPane({ fileKey, page, style, height }: Props) {
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: height ?? "calc(100vh - 160px)",
                minHeight: 380,
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,.18)",
                background: "rgba(2,6,23,.6)",
                ...style
            }}
        >
            {fileKey ? (
                <WebpSlide fileKey={fileKey} page={page} fit="height" maxHeight="calc(100vh - 180px)" />
            ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>자료 없음</div>
            )}
        </div>
    );
}
