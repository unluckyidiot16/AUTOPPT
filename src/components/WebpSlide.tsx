// src/components/WebpSlide.tsx  ★ 전체 교체
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

function slidesPrefixFromPdfKey(fileKey: string) {
    return String(fileKey).replace(/^presentations\//i, "").replace(/\.pdf$/i, "");
}

export default function WebpSlide({
                                      fileKey,
                                      page,
                                      height = "60vh",
                                      version = 0,
                                      style,
                                  }: {
    fileKey: string;
    page: number;
    height?: string | number;
    version?: number;
    style?: React.CSSProperties;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const prefix = useMemo(() => slidesPrefixFromPdfKey(fileKey), [fileKey]);

    useEffect(() => {
        let dead = false;
        (async () => {
            if (!fileKey || !page || page < 1) {
                setUrl(null);
                return;
            }
            const fname = `${prefix}/${page}.webp`;

            // slides 버킷 → presentations 버킷 순서로 public URL 생성
            const s1 = supabase.storage.from("slides").getPublicUrl(fname).data.publicUrl;
            if (s1 && !dead) { setUrl(`${s1}?v=${version}`); return; }

            const s2 = supabase.storage.from("presentations").getPublicUrl(fname).data.publicUrl;
            if (s2 && !dead) { setUrl(`${s2}?v=${version}`); return; }

            setUrl(null);
        })();
        return () => { dead = true; };
    }, [fileKey, page, prefix, version]);

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
