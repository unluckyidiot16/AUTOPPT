// src/components/EditorPreviewPane.tsx
import React from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

const __DBG =
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).has("debugSlides");

type Overlay = { id: string; z?: number; type: string; payload?: any };

type Props = {
    fileKey: string;
    page: number; // 1-base. 0이면 빈 캔버스 취급
    isBlank?: boolean;           // 빈 페이지 강제 표시
    height?: number | string;
    version?: number | string;   // 캐시버스터
    overlays?: Overlay[];        // 0..1 정규 좌표
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
        default: return null; // auto
    }
}

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              isBlank,
                                              height = "calc(100vh - 220px)",
                                              version,
                                              overlays = [],
                                              zoom = 1,
                                              aspectMode = "auto",
                                          }: Props) {
    const [url, setUrl] = React.useState<string | null>(null);
    const [err, setErr] = React.useState<string | null>(null);

    const ratio = aspectToRatio(aspectMode);
    const paddingTop = ratio ? `${100 / ratio}%` : undefined;

    // 배경 이미지 URL 생성
    React.useEffect(() => {
        let alive = true;
        setUrl(null);
        setErr(null);

        // 빈 페이지 표시 모드면 URL 생성 생략
        if (isBlank || !fileKey || Number(page || 0) <= 0) return;

        (async () => {
            try {
                const u = await resolveWebpUrl(fileKey, page, { cachebuster: true });
                if (__DBG) console.log("[preview] resolved", { fileKey, page, url: u });
                if (!alive) return;
                setUrl(u);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message || "미리보기 URL 생성 실패");
            }
        })();

        return () => { alive = false; };
    }, [fileKey, page, version, isBlank]);

    const StageBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div
            style={{
                position: "relative",
                width: "100%",
                maxWidth: "100%",
            }}
        >
            {ratio ? <div style={{ paddingTop }} /> : null}
            <div
                style={{
                    position: ratio ? "absolute" : "relative",
                    inset: ratio ? 0 : undefined,
                    display: "grid",
                    placeItems: "center",
                }}
            >
                {children}
            </div>
        </div>
    );

    return (
        <div
            className="panel"
            style={{
                height,
                position: "relative",
                overflow: "hidden",
                background: "#0b1220",
            }}
        >
            {/* 본문 배경 (이미지 or 빈 캔버스) */}
            <div
                style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                }}
            >
                <StageBox>
                    {/* 빈 페이지 or 이미지 */}
                    {isBlank || Number(page || 0) <= 0 ? (
                        <div
                            style={{
                                width: "100%",
                                height: "100%",
                                background: "#ffffff",
                                borderRadius: 2,
                                transform: `scale(${zoom})`,
                                transformOrigin: "center",
                            }}
                        />
                    ) : url ? (
                        <img
                            src={url}
                            alt={`page-${page}`}
                            style={{
                                maxWidth: "100%",
                                maxHeight: "100%",
                                transform: `scale(${zoom})`,
                                transformOrigin: "center",
                                userSelect: "none",
                                zIndex: 0, // 이미지 레이어는 항상 아래
                            }}
                            draggable={false}
                        />
                    ) : (
                        <div style={{ opacity: 0.6, fontSize: 12 }}>{err || "로딩 중…"}</div>
                    )}
                </StageBox>
            </div>

            {/* 퀴즈 오버레이(최상위 z-index) */}
            {Array.isArray(overlays) &&
                overlays.map((ov) => {
                    const p = ov?.payload || {};
                    const left = `${(Number(p.x ?? 0) * 100).toFixed(4)}%`;
                    const top = `${(Number(p.y ?? 0) * 100).toFixed(4)}%`;
                    const width = `${(Number(p.w ?? 0) * 100).toFixed(4)}%`;
                    const height = `${(Number(p.h ?? 0) * 100).toFixed(4)}%`;
                    const zIndex = (ov.z ?? 0) + 1000; // 항상 이미지 위

                    const question =
                        p.prompt ?? p.question ?? p.title ?? p.label ?? "";
                    const bg = p.bg ?? p.bgColor ?? "rgba(255,255,255,0.06)";
                    const fg = p.fg ?? p.fgColor ?? "#E5E7EB";

                    return (
                        <div
                            key={ov.id}
                            style={{
                                position: "absolute",
                                left,
                                top,
                                width,
                                height,
                                border: "1px dashed rgba(255,255,255,0.35)",
                                background: bg,
                                color: fg,
                                fontSize: 12,
                                display: "grid",
                                placeItems: "center",
                                zIndex,
                                pointerEvents: "none",
                                borderRadius: 8,
                                padding: 4,
                                backdropFilter: "blur(1px)",
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
