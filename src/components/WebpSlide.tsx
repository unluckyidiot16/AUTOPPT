// src/components/WebpSlide.tsx
import React from "react";
import { supabase } from "../supabaseClient";

type FitMode = "height" | "width";
type Props = {
    /** decks.file_key (ex: rooms/<room>/decks/<deck>/slides-TS.pdf) */
    fileKey: string;
    page: number;                // 1..N
    fit?: FitMode;               // 기본: height
    maxHeight?: string;          // fit=height일 때 사용
    /** 캐시 무효화용 키 (예: cacheVer) */
    versionKey?: string | number;
    style?: React.CSSProperties;
};

function buildWebpKey(fileKey: string, page: number) {
    // bucket prefix 제거 + .pdf 제거 → rooms/.../slides-TS/1.webp
    const rel = String(fileKey).replace(/^presentations\//i, "").replace(/\.pdf$/i, "");
    return `${rel}/${page}.webp`;
}

export default function WebpSlide({
                                      fileKey, page, fit = "height", maxHeight = "82vh", versionKey, style,
                                  }: Props) {
    const [src, setSrc] = React.useState<string | null>(null);
    const [err, setErr] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        setSrc(null);
        setErr(null);
        (async () => {
            try {
                const key = buildWebpKey(fileKey, page);
                const { data } = supabase.storage.from("presentations").getPublicUrl(key);
                const url = data?.publicUrl || null;
                if (!alive) return;
                if (!url) { setErr("이미지 URL 생성 실패"); return; }
                // 캐시버스터(선택)
                setSrc(versionKey != null ? `${url}?v=${encodeURIComponent(String(versionKey))}` : url);
            } catch (e: any) {
                if (!alive) return;
                setErr(e?.message || "이미지 찾기 실패");
            }
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
            className="pdf-stage"
            style={{ display: "grid", placeItems: "center", width: "100%", height: fit === "width" ? "100%" : "auto", ...style }}
        >
            {content}
        </div>
    );
}
