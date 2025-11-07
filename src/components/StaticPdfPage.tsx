// src/components/StaticPdfPage.tsx  (workerless-safe)
import React, { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "../lib/pdfjs";

type PDFDoc = any;
type PDFPage = any;
type FitMode = "height" | "width";

export default function StaticPdfPage({
                                          fileUrl,
                                          page,
                                          fit = "height",
                                          maxHeight = "82vh",
                                      }: {
    fileUrl: string;
    page: number;        // 1..N
    fit?: FitMode;       // height | width
    maxHeight?: string;  // fit=height 일 때만 사용
}) {
    const wrapRef   = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!fileUrl || page <= 0) return;

        let cancelled = false;
        let pdf: PDFDoc | null = null;
        let renderTask: any = null;
        let pdfTask: any = null;

        (async () => {
            try {
                const pdfjs: any = await loadPdfJs();
                pdfTask = pdfjs.getDocument({ url: fileUrl, withCredentials: false, disableWorker: true });
                pdf = await pdfTask.promise;
                if (cancelled) { await pdf?.destroy?.(); return; }

                const p: PDFPage = await pdf.getPage(page);
                const base = p.getViewport({ scale: 1 });

                // ── 스케일 계산
                let scale = 1;
                if (fit === "width") {
                    const w = wrapRef.current?.clientWidth ?? base.width;
                    scale = Math.max(0.1, (w - 16) / base.width);
                } else {
                    const targetH = Number(String(maxHeight).replace(/[^\d.]/g, "")) || 640;
                    scale = Math.max(0.1, (targetH - 16) / base.height);
                }
                const vp = p.getViewport({ scale });

                // ── 캔버스 준비 & 렌더
                const canvas = canvasRef.current;
                if (!canvas) return;
                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                canvas.style.width = `${Math.floor(vp.width)}px`;
                canvas.style.height = `${Math.floor(vp.height)}px`;

                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) return;

                renderTask = p.render({ canvasContext: ctx, viewport: vp });
                await renderTask.promise;
                try { p.cleanup?.(); } catch {}
            } catch {
                if (!cancelled) setErr("미리보기 로드 실패");
            }
        })();

        return () => {
            cancelled = true;
            try { renderTask?.cancel?.(); } catch {}
            try { pdfTask?.destroy?.(); } catch {}
            try { pdf?.destroy?.(); } catch {}
        };
    }, [fileUrl, page, fit, maxHeight]);

    return (
        <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
            <canvas ref={canvasRef} />
            {err && (
                <div style={{
                    position: "absolute", inset: 0, display: "grid", placeItems: "center",
                    color: "#ef4444", background: "rgba(2,6,23,.4)"
                }}>{err}</div>
            )}
        </div>
    );
}
