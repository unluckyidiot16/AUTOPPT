// src/components/WebpSlide.tsx  ← 전체 교체
import React, { useEffect, useState } from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

type Props = {
    fileKey: string;          // presentations/.../slides-TS.pdf 또는 decks/.../slides-TS.pdf
    page: number;             // 1-base
    height?: number | string;
    style?: React.CSSProperties;
    version?: number | string;    // 캐시버스터용(선택)
    versionKey?: number | string; // (구버전 호환)
};

export default function WebpSlide({
                                      fileKey, page, height = "60vh", style, version, versionKey,
                                  }: Props) {
    const [url, setUrl] = useState<string | null>(null);
    const ver = String(version ?? versionKey ?? "");

    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) { if (!off) setUrl(null); return; }
            // ✅ 1→0 변환 + slidesPrefix 계산 + Signed URL 생성까지 한 번에
            const u = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: !!ver });
            if (!off) setUrl(u);
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    if (!fileKey || !page || page < 1) {
        return <div style={{ height, display: "grid", placeItems: "center", opacity: 0.6 }}>이미지 없음</div>;
    }
    if (!url) {
        return <div style={{ height, display: "grid", placeItems: "center", opacity: 0.6 }}>로드 중…</div>;
    }
    return (
        <div style={{ height, overflow: "hidden", ...style }}>
            <img
                src={url}
                alt={`slide ${page}`}
                style={{ height: "100%", width: "auto", display: "block", margin: "0 auto" }}
                draggable={false}
            />
        </div>
    );
}
