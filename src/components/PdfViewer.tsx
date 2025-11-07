// src/components/PdfViewer.tsx  (full replace)
import React from "react";
import { loadPdfJs } from "../lib/pdfjs";

type Props = {
    fileUrl: string;
    page?: number;            // 1-based
    maxHeight?: string;       // e.g. "500px"
};

export default function PdfViewer({ fileUrl, page = 1, maxHeight }: Props) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const [err, setErr] = React.useState<string | null>(null);

    React.useEffect(() => {
        let mounted = true;
        let loadingTask: any = null;
        let pdfDoc: any = null;
        let renderTask: any = null;

        (async () => {
            setErr(null);
            const canvas = canvasRef.current;
            if (!canvas) return;

            try {
                const pdfjs: any = await loadPdfJs();
                loadingTask = pdfjs.getDocument({ url: fileUrl, disableWorker: true });
                const pdf = await loadingTask.promise;
                if (!mounted) return;
                pdfDoc = pdf;

                const p = Math.max(1, Math.min(page ?? 1, pdf.numPages));
                const pdfPage = await pdf.getPage(p);
                if (!mounted) return;

                const dpr = window.devicePixelRatio || 1;
                const viewport = pdfPage.getViewport({ scale: 1 });

                let scale = dpr;
                if (maxHeight) {
                    const h = parseFloat(maxHeight);
                    if (!Number.isNaN(h) && h > 0) scale = (h * dpr) / viewport.height;
                }

                const vp = pdfPage.getViewport({ scale });
                canvas.width = Math.max(1, Math.floor(vp.width));
                canvas.height = Math.max(1, Math.floor(vp.height));
                canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
                canvas.style.height = `${Math.floor(vp.height / dpr)}px`;

                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) throw new Error("Canvas 2D context not available");

                renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
                await renderTask.promise;
            } catch (e: any) {
                const msg = String(e?.message || e);
                if (
                    msg.includes("Worker was terminated") ||
                    e?.name === "AbortException" ||
                    e?.name === "RenderingCancelledException"
                ) return;
                if (mounted) setErr("PDF 로드 실패");
                console.debug("[PdfViewer] error:", e);
            }
        })();

        return () => {
            mounted = false;
            try { renderTask?.cancel?.(); } catch {}
            try { loadingTask?.destroy?.(); } catch {}
            try { pdfDoc?.destroy?.(); } catch {}
        };
    }, [fileUrl, page, maxHeight]);

    return (
        <div style={{ width: "100%", display: "grid", placeItems: "center", maxHeight, overflow: "hidden" }}>
            {err ? <div style={{ fontSize: 12, opacity: 0.7, padding: 8 }}>파일을 불러올 수 없습니다.</div> : <canvas ref={canvasRef} />}
        </div>
    );
}
