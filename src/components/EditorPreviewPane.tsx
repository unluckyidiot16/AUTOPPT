// src/components/EditorPreviewPane.tsx
import React, { useEffect, useMemo, useState } from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

type Props = {
    fileKey: string;
    page: number;                 // 1-base, 0 => 빈 캔버스
    height?: number | string;     // 컨테이너 높이
    version?: number | string;    // 캐시 버스터
    overlays?: any[];             // 정규화 좌표(0..1)
    zoom?: 0.5 | 0.75 | 1 | 1.25 | 1.5;
    aspectMode?: "auto" | "16:9" | "16:10" | "4:3" | "3:2" | "A4";
};

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              height = "calc(100vh - 220px)",
                                              version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "16:9",
                                          }: Props) {
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const ver = useMemo(() => String(version ?? ""), [version]);

    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) {
                if (!off) setBgUrl(null);
                return;
            }
            try {
                const u = await resolveWebpUrl(fileKey, page, { ttlSec: 600, cachebuster: true });
                if (!off) setBgUrl(u);
            } catch {
                if (!off) setBgUrl(null);
            }
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    const aspectStyle: React.CSSProperties =
        aspectMode === "auto" ? {} :
            aspectMode === "16:9"  ? { aspectRatio: "16 / 9" }  :
                aspectMode === "16:10" ? { aspectRatio: "16 / 10" } :
                    aspectMode === "4:3"   ? { aspectRatio: "4 / 3" }   :
                        aspectMode === "3:2"   ? { aspectRatio: "3 / 2" }   :
                            { aspectRatio: "210 / 297" }; // A4

    const stageWidth = aspectMode === "auto" ? "min(100%, 1180px)" : "min(100%, 1480px)";

    return (
        <div
            className="editor-preview-pane"
            style={{
                height,
                display: "grid",
                placeItems: "start center",
                background: "rgba(2,6,23,.35)",
                borderRadius: 12,
                overflow: "auto",
                padding: 8,
            }}
        >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
                <div
                    style={{
                        ...aspectStyle,
                        width: stageWidth,
                        position: "relative",
                        backgroundColor: "rgba(15,23,42,.7)",
                        borderRadius: 10,
                        overflow: "hidden",
                    }}
                >
                    {/* 배경 이미지는 <img>로 직접 렌더 (배경 CSS 대신) */}
                    {bgUrl ? (
                        <img
                            src={bgUrl}
                            alt={`p${page}`}
                            style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                                userSelect: "none",
                                pointerEvents: "none",
                            }}
                            draggable={false}
                        />
                    ) : (
                        <div
                            style={{
                                position: "absolute", inset: 0,
                                display: "grid", placeItems: "center",
                                color: "#9CA3AF", fontSize: 14, opacity: 0.6,
                            }}
                        >
                            빈 페이지(배경 없음)
                        </div>
                    )}

                    {overlays
                        .slice()
                        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
                        .map((ov: any) => {
                            if (ov.type !== "quiz") return null;
                            const { x = 0.1, y = 0.1, w = 0.3, h = 0.2, question = "" } = ov.payload ?? {};
                            return (
                                <div
                                    key={ov.id}
                                    style={{
                                        position: "absolute",
                                        left: `${x * 100}%`, top: `${y * 100}%`,
                                        width: `${w * 100}%`, height: `${h * 100}%`,
                                        border: "2px dashed rgba(96,165,250,.9)",
                                        background: "rgba(2,132,199,.08)",
                                        borderRadius: 8,
                                        display: "grid", placeItems: "center",
                                        color: "#E5E7EB", fontSize: 12,
                                        pointerEvents: "none",
                                        zIndex: (ov.z ?? 0) + 100,
                                    }}
                                >
                                    {question || "퀴즈"}
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}
