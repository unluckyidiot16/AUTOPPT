// src/components/EditorPreviewPane.tsx
import React, { useEffect, useMemo, useState } from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

export type Overlay = {
    id: string;
    z?: number;
    type: "quiz" | string;
    payload: any;
};

type Props = {
    fileKey: string;
    page: number;                 // 1-base, 0 => 빈 캔버스
    height?: number | string;     // 기본: calc(100vh - 220px)
    version?: number | string;    // 캐시버스터
    overlays?: Overlay[];         // 퀴즈 등 오버레이
    zoom?: 0.75 | 1 | 1.25;       // 75/100/125%
    aspectMode?: "auto" | "16:9" | "4:3" | "A4";
};

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              height = "calc(100vh - 220px)",
                                              version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "auto",
                                          }: Props) {
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const ver = useMemo(() => String(version ?? ""), [version]);

    // page === 0 이면 절대 webp를 요청하지 않음
    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) {
                if (!off) setBgUrl(null);
                return;
            }
            try {
                const url = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: !!ver });
                if (!off) setBgUrl(url);
            } catch {
                if (!off) setBgUrl(null);
            }
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    // CSS aspect-ratio
    const aspectStyle: React.CSSProperties =
        aspectMode === "auto"
            ? {}
            : aspectMode === "16:9"
                ? { aspectRatio: "16 / 9" }
                : aspectMode === "4:3"
                    ? { aspectRatio: "4 / 3" }
                    : { aspectRatio: "210 / 297" }; // A4 (mm)

    return (
        <div
            className="editor-preview-pane"
            style={{
                height,
                display: "grid",
                placeItems: "center",
                background: "rgba(2,6,23,.35)",
                borderRadius: 12,
                overflow: "auto",
            }}
        >
            {/* 줌 스케일 */}
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}>
                {/* 스테이지 */}
                <div
                    style={{
                        ...aspectStyle,
                        width: aspectMode === "auto" ? "min(1000px, 90vw)" : "min(1200px, 92vw)",
                        height: aspectMode === "auto" ? "calc(100vh - 260px)" : "auto",
                        position: "relative",
                        backgroundColor: "rgba(15,23,42,.7)",
                        backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
                        backgroundSize: "contain",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center",
                        borderRadius: 10,
                    }}
                >
                    {/* 빈 캔버스 워터마크 */}
                    {!bgUrl && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                                color: "#9CA3AF",
                                fontSize: 14,
                                opacity: 0.6,
                            }}
                        >
                            빈 페이지(배경 없음)
                        </div>
                    )}

                    {/* 오버레이(정규화 좌표 x,y,w,h 0..1) */}
                    {overlays
                        .slice()
                        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
                        .map((ov) => {
                            if (ov.type !== "quiz") return null;
                            const { x = 0.1, y = 0.1, w = 0.3, h = 0.2, question = "" } = ov.payload ?? {};
                            return (
                                <div
                                    key={ov.id}
                                    style={{
                                        position: "absolute",
                                        left: `${x * 100}%`,
                                        top: `${y * 100}%`,
                                        width: `${w * 100}%`,
                                        height: `${h * 100}%`,
                                        border: "2px dashed rgba(96,165,250,.9)",
                                        background: "rgba(2,132,199,.08)",
                                        borderRadius: 8,
                                        display: "grid",
                                        placeItems: "center",
                                        color: "#E5E7EB",
                                        fontSize: 12,
                                        pointerEvents: "none",
                                        zIndex: (ov.z ?? 0) + 100, // ★ 항상 배경 위
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
