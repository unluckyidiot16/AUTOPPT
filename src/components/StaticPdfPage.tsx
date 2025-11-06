// src/components/StaticPdfPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// @ts-ignore
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

type PDFDoc = any;
type PDFPage = any;

let WORKER_BOUND = false;
function ensureWorker() {
    if (!WORKER_BOUND) {
        const w = new PdfJsWorker();
        GlobalWorkerOptions.workerPort = w;
        // @ts-ignore
        (globalThis as any).__autoppt_pdf_worker = w;
        WORKER_BOUND = true;
    }
}

export default function StaticPdfPage({
                                          fileUrl,
                                          page,
                                          maxHeight = "82vh",
                                      }: {
    fileUrl: string;
    page: number;        // 1..N
    maxHeight?: string;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!fileUrl || page <= 0) return;
        ensureWorker();

        let cancelled = false;
        let pdf: PDFDoc | null = null;
        let renderTask: any = null;
        let pdfTask: any = null;

        (async () => {
            try {
                pdfTask = getDocument({ url: fileUrl, withCredentials: false });
                pdf = await pdfTask.promise;
                if (cancelled) { await pdf?.destroy?.(); return; }

                const p: PDFPage = await pdf.getPage(page);
                const base = p.getViewport({ scale: 1 });

                // 높이 기준 스케일 (maxHeight px)
                const targetH = Number(String(maxHeight).replace(/[^\d.]/g, "")) || 640;
                const scale = Math.max(0.1, (targetH - 16) / base.height);
                const vp = p.getViewport({ scale });

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
    }, [fileUrl, page, maxHeight]);

    return (
        <div style={{ position: "relative" }}>
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
