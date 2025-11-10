// src/components/EditorPreviewPane.tsx  ★ 전체 교체
import React, { useEffect, useMemo, useState } from "react";
import SlideStage, { type Overlay } from "./SlideStage";
import { resolveWebpUrl } from "../utils/supaFiles";

type Props = {
    fileKey: string;
    page: number;              // 1-base, 0 => 빈 캔버스
    height?: number | string;  // 기본: calc(100vh - 220px)
    version?: number | string; // 캐시버스터
    overlays?: Overlay[];      // 프리뷰에 띄울 오버레이(퀴즈 등)
};

export default function EditorPreviewPane({
                                              fileKey,
                                              page,
                                              height = "calc(100vh - 220px)",
                                              version,
                                              overlays = [],
                                          }: Props) {
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const ver = useMemo(() => String(version ?? ""), [version]);

    useEffect(() => {
        let off = false;
        (async () => {
            if (!fileKey || !page || page < 1) { if (!off) setBgUrl(null); return; }
            try {
                const url = await resolveWebpUrl(fileKey, page, { ttlSec: 1800, cachebuster: !!ver });
                if (!off) setBgUrl(url);
            } catch { if (!off) setBgUrl(null); }
        })();
        return () => { off = true; };
    }, [fileKey, page, ver]);

    return (
        <div
            className="editor-preview-pane"
            style={{
                height,
                display: "grid",
                placeItems: "center",
                background: "rgba(2,6,23,.35)",
                borderRadius: 12,
                overflow: "hidden",
            }}
        >
            {/* SlideStage는 부모 크기에 맞추고 내부는 contain처럼 보이도록 */}
            <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                <SlideStage
                    bgUrl={bgUrl}
                    overlays={overlays}
                    mode="teacher"
                />
            </div>
        </div>
    );
}
