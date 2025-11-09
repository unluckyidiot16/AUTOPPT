// src/components/EditorPreviewPane.tsx
import React, { useEffect, useState } from "react";
import SlideStage, { type Overlay } from "./SlideStage";
import { resolveWebpUrl } from "../utils/supaFiles";

type Props = {
    fileKey: string;
    page: number;                 // 1-base, 0 => 빈 캔버스
    height?: number | string;
    version?: number | string;    // 캐시버스터
    overlays?: Overlay[];         // 프리뷰에 띄울 오버레이(퀴즈 등)
};

export default function EditorPreviewPane({ fileKey, page, height = "60vh", version, overlays = [] }: Props) {
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const ver = String(version ?? "");
    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) { if (!off) setBgUrl(null); return; }
            const u = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: !!ver });
            if (!off) setBgUrl(u);
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    return (
        <div style={{ height, display: "grid", placeItems: "center", background: "rgba(2,6,23,.35)", borderRadius: 12 }}>
            <SlideStage bgUrl={bgUrl} overlays={overlays} mode="teacher" />
        </div>
    );
}
