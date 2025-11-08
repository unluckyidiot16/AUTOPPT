// src/components/WebpThumb.tsx
import React from "react";
import { supabase } from "../supabaseClient";

function buildWebpKey(fileKey: string, page: number) {
    const rel = String(fileKey).replace(/^presentations\//i, "").replace(/\.pdf$/i, "");
    return `${rel}/${page}.webp`;
}

export default function WebpThumb({
                                      fileKey, page, width = 120, height = 80, style, title, version,
                                  }: {
    fileKey: string;
    page: number;
    width?: number;
    height?: number;
    style?: React.CSSProperties;
    title?: string;
    /** 캐시 무효화용 키(선택) */
    version?: number | string;
}) {
    const [src, setSrc] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        (async () => {
            const key = buildWebpKey(fileKey, page);
            const { data } = supabase.storage.from("presentations").getPublicUrl(key);
            const url = data?.publicUrl || null;
            if (!alive) return;
            setSrc(url ? (version != null ? `${url}?v=${encodeURIComponent(String(version))}` : url) : null);
        })();
        return () => { alive = false; };
    }, [fileKey, page, version]);

    return (
        <div style={{ width, height, overflow: "hidden", borderRadius: 8, background: "#111827", ...style }} title={title}>
            {src ? (
                <img src={src} alt={`p${page}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.6 }}>…</div>
            )}
        </div>
    );
}
