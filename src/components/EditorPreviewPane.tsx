// src/components/EditorPreviewPane.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { signedSlidesUrl } from "../utils/supaFiles";

type OverlayQuiz = {
    id: string;
    z?: number;
    type: "quiz";
    payload: {
        x: number; y: number; w: number; h: number;
        position?: "tl" | "tr" | "bl" | "br" | "free";
        draggable?: boolean;
        prompt?: string;
        keywords?: string[];
        threshold?: number;
        bg?: string; fg?: string;
    };
};

export type Overlay = OverlayQuiz; // 확장 여지

export default function EditorPreviewPane({
                                              fileKey, page, isBlank, version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "16:9",
                                              onMoveOverlay,
                                          }: {
    fileKey: string;
    page: number;
    isBlank?: boolean;
    version?: number;
    overlays?: Overlay[];
    zoom?: 0.5 | 0.75 | 1 | 1.25 | 1.5;
    aspectMode?: "auto" | "16:9" | "16:10" | "4:3" | "3:2" | "A4";
    onMoveOverlay?: (id: string, x: number, y: number) => void;
}) {
    const [imgUrl, setImgUrl] = useState<string | null>(null);

    const ratio = useMemo(() => {
        switch (aspectMode) {
            case "16:10": return 16 / 10;
            case "4:3":   return 4 / 3;
            case "3:2":   return 3 / 2;
            case "A4":    return 210 / 297;
            default:      return 16 / 9;
        }
    }, [aspectMode]);

    // 이미지 URL
    useEffect(() => {
        let off = false;
        (async () => {
            if (isBlank) { setImgUrl(null); return; }
            const idx0 = Math.max(0, page - 1);
            const url = await signedSlidesUrl(`${fileKey}/${idx0}.webp`, 120);
            if (!off) setImgUrl(url);
        })();
        return () => { off = true; };
    }, [fileKey, page, version, isBlank]);

    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);

    // 드래그 핸들러
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;

        const onPointerDown = (e: PointerEvent) => {
            const target = (e.target as HTMLElement)?.closest('[data-ov="1"]') as HTMLElement | null;
            if (!target) return;
            if (target.getAttribute("data-draggable") !== "1") return;
            const id = target.getAttribute("data-id")!;
            const rect = el.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            dragRef.current = { id, ox: x, oy: y };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!dragRef.current) return;
            const rect = el.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            const dx = x, dy = y;
            // 경계 클램프
            const nx = Math.max(0, Math.min(1, dx));
            const ny = Math.max(0, Math.min(1, dy));
            onMoveOverlay?.(dragRef.current.id, nx, ny);
        };
        const onPointerUp = () => { dragRef.current = null; };

        el.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [onMoveOverlay, zoom]);

    // 스타일
    const baseW = 960;                 // 프리뷰 기준 폭
    const w = Math.round(baseW * zoom);
    const h = Math.round(w / ratio);

    return (
        <div
            ref={stageRef}
            style={{
                position: "relative",
                width: w,
                height: h,
                border: "1px solid rgba(148,163,184,.25)",
                borderRadius: 12,
                overflow: "hidden",
                background: isBlank ? "#fff" : "transparent",
                userSelect: "none",
            }}
        >
            {!isBlank && imgUrl && (
                <img
                    src={imgUrl}
                    alt="slide"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                    draggable={false}
                />
            )}

            {/* overlays */}
            {overlays.map((ov) => {
                if (ov.type !== "quiz") return null;
                const { x, y, w, h, bg, fg, draggable } = ov.payload;
                return (
                    <div
                        key={ov.id}
                        data-ov="1"
                        data-id={ov.id}
                        data-draggable={draggable ? "1" : "0"}
                        style={{
                            position: "absolute",
                            left: `${x * 100}%`,
                            top: `${y * 100}%`,
                            width: `${w * 100}%`,
                            height: `${h * 100}%`,
                            transform: "translate(-0%, -0%)",
                            zIndex: ov.z ?? 20,
                            display: "grid",
                            gap: 6,
                            borderRadius: 10,
                            padding: 10,
                            background: bg ?? "rgba(17,24,39,.85)",
                            color: fg ?? "#fff",
                            cursor: draggable ? "grab" : "default",
                            boxShadow: "0 2px 10px rgba(0,0,0,.25)",
                        }}
                        title={draggable ? "드래그하여 위치를 조정하세요" : ""}
                    >
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {ov?.payload?.prompt || "(문항 없음)"}
                        </div>
                        <div style={{ fontSize: 11, opacity: .75 }}>
                            키워드: {(ov?.payload?.keywords ?? []).join(", ")} · 임계: {ov?.payload?.threshold ?? 1}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
