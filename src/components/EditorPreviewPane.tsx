// src/components/EditorPreviewPane.tsx
import React from "react";
import WebpSlide from "./WebpSlide";

type Props = {
    fileKey: string | null; // PDF key
    page: number;
    style?: React.CSSProperties;
    height?: number | string;
    /** 1분 단위 등 외부에서 전달되는 캐시 버전 → 키로 사용해 안전 리프레시 */
    version?: number | string;
};

export default function EditorPreviewPane({ fileKey, page, style, height, version }: Props) {
    const key = `${fileKey ?? "none"}-${page}-${version ?? ""}`;
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
                <WebpSlide key={key} fileKey={fileKey} page={page} fit="height" maxHeight="calc(100vh - 180px)" />
            ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>자료 없음</div>
            )}
        </div>
    );
}
