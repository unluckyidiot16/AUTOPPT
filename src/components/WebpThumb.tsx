// src/components/WebpThumb.tsx
import React from "react";
import { resolveWebpUrl } from "../utils/supaFiles";

export default function WebpThumb({
                                      fileKey, page, width = 120, height = 80, style, title,
                                  }: {
    fileKey: string;
    page: number;
    width?: number;
    height?: number;
    style?: React.CSSProperties;
    title?: string;
}) {
    const [src, setSrc] = React.useState<string | null>(null);

    React.useEffect(() => {
        let alive = true;
        if (!fileKey || !page || page < 1) { setSrc(null); return; }
        (async () => {
            const url = await resolveWebpUrl(fileKey, page);
            if (!alive) return;
            setSrc(url);
        })();
        return () => { alive = false; };
    }, [fileKey, page]);

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
