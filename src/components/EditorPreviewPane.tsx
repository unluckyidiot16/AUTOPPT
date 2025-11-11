// src/components/EditorPreviewPane.tsx
import React from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

const __DBG =
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).has("debugSlides");

type Overlay = { id: string; z?: number; type: string; payload?: any };

type Props = {
    fileKey: string;                // slides prefix or presentations key
    page: number;                   // 1-based (0이면 빈 화면)
    height?: number | string;       // 컨테이너 높이
    version?: number | string;      // 캐시 버스터
    overlays?: Overlay[];           // 정규좌표(0..1)
    zoom?: 0.5 | 0.75 | 1 | 1.25 | 1.5;
    aspectMode?: "auto" | "16:9" | "16:10" | "4:3" | "3:2" | "A4";
};

function aspectToRatio(mode: Props["aspectMode"]) {
    switch (mode) {
        case "16:9": return 16 / 9;
        case "16:10": return 16 / 10;
        case "4:3": return 4 / 3;
        case "3:2": return 3 / 2;
        case "A4": return 210 / 297; // w/h
        default: return null;         // auto
    }
}

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              height = "calc(100vh - 220px)",
                                              version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "auto",
                                          }: Props) {
    const [url, setUrl] = React.useState<string | null>(null);
    const [err, setErr] = React.useState<string | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // URL 준비(썸네일과 동일 경로: <img src>에 그대로 사용)
    React.useEffect(() => {
        let alive = true;
        setUrl(null);
        setErr(null);

        const p = Number(page || 0);
        if (!fileKey || !p) return;

        (async () => {
            try {
                const u = await resolveWebpUrl(fileKey, p, { cachebuster: true });
                if (__DBG) console.log("[preview] resolved", { fileKey, page: p, url: u });
                if (!alive) return;
                setUrl(u);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message || "미리보기 URL 생성 실패");
            }
        })();

        return () => { alive = false; };
    }, [fileKey, page, version]);

    const ratio = aspectToRatio(aspectMode);
    const paddingTop = ratio ? `${100 / ratio}%` : undefined; // aspect-ratio 흉내

    return (
        <div
            ref={containerRef}
            className="panel"
            style={{
                height,
                position: "relative",
                overflow: "hidden",
                background: "#0b1220",
            }}
        >
            {/* 슬라이드 본문(이미지) */}
            <div
                style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                }}
            >
                {/* 고정 비율 모드 */}
                {ratio ? (
                    <div style={{ position: "relative", width: "100%", maxWidth: "100%" }}>
                        <div style={{ paddingTop }} />
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                            }}
                        >
                            {url ? (
                                <img
                                    src={url}
                                    alt={`page-${page}`}
                                    style={{
                                        maxWidth: "100%",
                                        maxHeight: "100%",
                                        transform: `scale(${zoom})`,
                                        transformOrigin: "center center",
                                        userSelect: "none",
                                    }}
                                    draggable={false}
                                />
                            ) : (
                                <div style={{ opacity: 0.6, fontSize: 12 }}>{err || "로딩 중…"}</div>
                            )}
                        </div>
                    </div>
                ) : (
                    // auto 모드
                    url ? (
                        <img
                            src={url}
                            alt={`page-${page}`}
                            style={{
                                maxWidth: "100%",
                                maxHeight: "100%",
                                transform: `scale(${zoom})`,
                                transformOrigin: "center center",
                                userSelect: "none",
                            }}
                            draggable={false}
                        />
                    ) : (
                        <div style={{ opacity: 0.6, fontSize: 12 }}>{err || "로딩 중…"}</div>
                    )
                )}
            </div>

            {/* 오버레이(정규좌표 0..1) */}
            {Array.isArray(overlays) && overlays.map((ov) => {
                const p = ov?.payload || {};
                const left = `${(Number(p.x ?? 0) * 100).toFixed(4)}%`;
                const top = `${(Number(p.y ?? 0) * 100).toFixed(4)}%`;
                const width = `${(Number(p.w ?? 0) * 100).toFixed(4)}%`;
                const height = `${(Number(p.h ?? 0) * 100).toFixed(4)}%`;
                const zIndex = (ov.z ?? 0) + 100;

                const question =
                    p.prompt ?? p.question ?? p.title ?? p.label ?? "";

                return (
                    <div
                        key={ov.id}
                        style={{
                            position: "absolute",
                            left, top, width, height,
                            border: "1px dashed rgba(255,255,255,0.5)",
                            background: "rgba(255,255,255,0.04)",
                            color: "#E5E7EB",
                            fontSize: 12,
                            display: "grid",
                            placeItems: "center",
                            zIndex,
                            pointerEvents: "none",
                        }}
                        title={question}
                    >
                        {question || "퀴즈"}
                    </div>
                );
            })}
        </div>
    );
}
