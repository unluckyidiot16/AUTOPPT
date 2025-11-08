// src/components/EditorPreviewPane.tsx
import React from "react";
import WebpSlide from "./WebpSlide";

type Props = {
    fileKey: string | null;
    page: number;                      // 0이면 '변환 전'
    style?: React.CSSProperties;
    height?: number | string;
    version?: number | string;         // 캐시버스터
};

export default function EditorPreviewPane({ fileKey, page, style, height, version }: Props) {
    const key = `${fileKey ?? "none"}-${page}-${version ?? ""}`;
    const showImage = !!fileKey && page > 0;

    return (
        <div
            style={{
                height: height ?? "calc(100vh - 220px)",
                overflow: "hidden",
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,.18)",
                background: "rgba(2,6,23,.6)",
                ...style,
            }}
        >
            {showImage ? (
                <WebpSlide key={key} fileKey={fileKey!} page={page} fit="height" maxHeight="calc(100vh - 180px)" versionKey={version} />
            ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>
                    {fileKey ? "이미지 변환 대기…" : "자료 없음"}
                </div>
            )}
        </div>
    );
}
