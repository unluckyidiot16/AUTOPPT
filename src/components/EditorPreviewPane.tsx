// src/components/EditorPreviewPane.tsx  ★ 전체 교체
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Overlay } from "./SlideStage"; // 타입만 재사용
import { resolveWebpUrl } from "../utils/supaFiles";

/** 사용 예:
 * <EditorPreviewPane
 *    fileKey={fileKey}
 *    page={previewBgPage}               // 1..N, 0은 빈 캔버스
 *    height="calc(100vh - 220px)"
 *    version={cacheVer}
 *    overlays={overlaysForPreview}      // 퀴즈 등
 *    zoom={zoom}                        // 0.75 | 1 | 1.25
 *    aspectMode={aspectMode}            // "auto" | "16:9" | "4:3" | "A4"
 * />
 */

type Props = {
    fileKey: string;
    page: number;                   // 1-base, 0 => 빈 캔버스
    height?: number | string;
    version?: number | string;      // 캐시버스터
    overlays?: Overlay[];
    zoom?: 0.75 | 1 | 1.25;
    aspectMode?: "auto" | "16:9" | "4:3" | "A4";
};

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              height = "60vh",
                                              version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "auto",
                                          }: Props) {
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const [naturalRatio, setNaturalRatio] = useState<number | null>(16 / 9); // auto일 때 이미지 비율 측정값
    const ver = String(version ?? "");

    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) {
                if (!off) setBgUrl(null);              // ★ 빈 페이지(배경 없음)
                return;
            }
            const u = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: !!ver });
            if (!off) setBgUrl(u);
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    // 비율 결정: auto면 이미지의 naturalWidth/Height로 측정
    const forcedRatio = useMemo(() => {
        if (aspectMode === "16:9") return 16 / 9;
        if (aspectMode === "4:3")  return 4 / 3;
        if (aspectMode === "A4")   return 1.4142; // A4 landscape(√2:1)
        return null; // auto
    }, [aspectMode]);

    const stageRatio = forcedRatio ?? naturalRatio ?? 16 / 9;

    const wrapperStyle: CSSProperties = {
        height,
        display: "grid",
        placeItems: "center",
        background: "rgba(2,6,23,.35)",
        borderRadius: 12,
        overflow: "hidden",
    };

    const stageOuter: CSSProperties = {
        // 뷰포트에 맞춰 contain, 줌은 content에만 적용
        width: "100%",
        maxWidth: "100%",
        aspectRatio: String(stageRatio),
        position: "relative",
        userSelect: "none",
    };

    const contentScale: CSSProperties = {
        position: "absolute",
        inset: 0,
        transform: `scale(${zoom})`,
        transformOrigin: "top left",
    };

    const imgStyle: CSSProperties = {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",          // stageRatio로 맞춰진 박스에 꽉 채우기
        borderRadius: 8,
    };

    // overlay는 0~1 정규화 좌표라고 가정: x,y,w,h
    const overlayBox = (ov: Overlay, i: number) => {
        const p = (ov as any).payload || {};
        const style: CSSProperties = {
            position: "absolute",
            left: `${(p.x ?? 0) * 100}%`,
            top: `${(p.y ?? 0) * 100}%`,
            width: `${(p.w ?? 0.3) * 100}%`,
            height: `${(p.h ?? 0.2) * 100}%`,
            border: "2px dashed rgba(56,189,248,.9)",
            borderRadius: 8,
            background: "rgba(56,189,248,.08)",
            color: "#e2f3ff",
            fontSize: 12,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
        };
        const label = p.question ? `Q: ${String(p.question).slice(0, 28)}…` : "퀴즈";
        return <div key={ov.id ?? `ov-${i}`} style={style}>{label}</div>;
    };

    return (
        <div className="editor-preview-pane" style={wrapperStyle}>
            <div style={stageOuter}>
                {/* 배경 이미지(페이지가 1..N일 때만). onLoad로 natural ratio 측정 */}
                {bgUrl ? (
                    <img
                        src={bgUrl}
                        alt=""
                        style={imgStyle}
                        onLoad={(e) => {
                            const img = e.currentTarget;
                            if (aspectMode === "auto" && img?.naturalWidth && img?.naturalHeight) {
                                setNaturalRatio(img.naturalWidth / img.naturalHeight);
                            }
                        }}
                    />
                ) : (
                    // 빈 페이지면 밝은 도트 배경
                    <div style={{
                        position: "absolute", inset: 0, borderRadius: 8,
                        background:
                            "repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 8px, rgba(255,255,255,.1) 8px 9px)," +
                            "linear-gradient(180deg, rgba(2,6,23,.6), rgba(2,6,23,.6))",
                    }} />
                )}

                {/* content(오버레이) 레이어: scale로 줌 */}
                <div style={contentScale}>
                    {overlays.map(overlayBox)}
                </div>
            </div>
        </div>
    );
}
