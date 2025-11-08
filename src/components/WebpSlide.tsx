// src/components/WebpSlide.tsx
import React from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

type FitMode = "height" | "width";
type Props = {
    /** decks.file_key (ex: rooms/<room>/decks/<deck>/slides-TS.pdf) */
    fileKey: string;
    page: number;                // 1..N
    fit?: FitMode;               // 기본: height
    maxHeight?: string;          // fit=height일 때 사용 (ex "80vh")
    versionKey?: string;         // 캐시버스터용(덱/페이지 변화 트래킹 문자열)
    style?: React.CSSProperties;
};

export default function WebpSlide({
                                      fileKey, page, fit = "height", maxHeight = "82vh", versionKey, style
                                  }: Props) {
    const [src, setSrc] = React.useState<string | null>(null);
    const [err, setErr] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        setSrc(null);
        setErr(null);
        (async () => {
            const url = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: true });
            if (!alive) return;
            if (url) setSrc(url);
            else setErr("이미지 찾기 실패");
        })();
        return () => { alive = false; };
    }, [fileKey, page, versionKey]);

    const content =
        err ? (
            <div style={{ color: "#f87171", padding: 12, textAlign: "center" }}>{err}</div>
        ) : !src ? (
            <div style={{ opacity: 0.6, padding: 12, textAlign: "center" }}>불러오는 중…</div>
        ) : (
            <img
                src={src}
                alt={`page ${page}`}
                loading="eager"
                style={{
                    display: "block",
                    maxWidth: "100%",
                    height: fit === "height" ? "auto" : "100%",
                    maxHeight: fit === "height" ? maxHeight : undefined,
                    objectFit: "contain",
                    borderRadius: 12,
                }}
            />
        );

    return (
        <div
            className="pdf-stage" // 기존 풀스크린 토글 대상 재사용
            style={{
                display: "grid", placeItems: "center",
                width: "100%", height: fit === "width" ? "100%" : "auto",
                ...style
            }}
        >
            {content}
        </div>
    );
}
