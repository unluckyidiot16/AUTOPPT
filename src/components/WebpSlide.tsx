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
    versionKey?: string;         // 캐시버스터용
    style?: React.CSSProperties;
};

export default function WebpSlide({
                                      fileKey, page, fit = "height", maxHeight = "80vh", versionKey, style,
                                  }: Props) {
    const [src, setSrc] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState<boolean>(false);

    React.useEffect(() => {
        let alive = true;

        // page<1 이거나 fileKey 없음 → 네트워크 호출 금지
        if (!fileKey || !page || page < 1) {
            setSrc(null);
            return;
        }

        (async () => {
            setLoading(true);
            const url = await resolveWebpUrl(fileKey, page);
            if (!alive) return;
            setSrc(url);
            setLoading(false);
        })();

        return () => { alive = false; };
    }, [fileKey, page, versionKey]);

    let content: React.ReactNode = (
        <div style={{ opacity: 0.6, padding: 12 }}>이미지 없음</div>
    );

    if (loading) {
        content = <div style={{ opacity: .6, padding: 12 }}>로딩 중…</div>;
    } else if (src) {
        content = (
            <img
                src={src}
                alt={`p${page}`}
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
    }

    return (
        <div
            className="pdf-stage"
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
