// src/components/PdfViewer.tsx  (full replace)
import React from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"; 


// 워커 경로 지정 (Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Props = {
    fileUrl: string;
    page?: number;            // 1-based
    maxHeight?: string;       // 예: "500px"
};

export default function PdfViewer({ fileUrl, page = 1, maxHeight }: Props) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const [err, setErr] = React.useState<string | null>(null);

    React.useEffect(() => {
        let mounted = true;
        let loadingTask: any = null;
        let pdfDoc: any = null;

        async function load() {
            setErr(null);
            const canvas = canvasRef.current;
            if (!canvas) return;

            try {
                // 새 문서 로딩
                loadingTask = pdfjsLib.getDocument({
                    url: fileUrl,
                    withCredentials: false, // 서명 URL CORS OK
                });

                const pdf = await loadingTask.promise;
                if (!mounted) return;
                pdfDoc = pdf;

                const p = Math.max(1, Math.min(page, pdf.numPages));
                const pdfPage = await pdf.getPage(p);
                if (!mounted) return;

                const dpr = window.devicePixelRatio || 1;
                const viewport = pdfPage.getViewport({ scale: 1 });
                let scale = 1;

                // maxHeight 지정 시 높이 기준 스케일 맞춤
                if (maxHeight) {
                    const h = parseFloat(maxHeight);
                    if (!Number.isNaN(h) && h > 0) scale = (h * dpr) / viewport.height;
                } else {
                    // 기본: 화면 DPR만큼 스케일 업
                    scale = dpr;
                }

                const vp = pdfPage.getViewport({ scale });
                canvas.width = Math.max(1, Math.floor(vp.width));
                canvas.height = Math.max(1, Math.floor(vp.height));
                canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
                canvas.style.height = `${Math.floor(vp.height / dpr)}px`;

                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) throw new Error("Canvas 2D context not available");

                const renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
                await renderTask.promise;
            } catch (e: any) {
                const msg = String(e?.message || e?.toString?.() || e);
                // 언마운트/중단 계열은 조용히 무시
                if (
                    msg.includes("Worker was terminated") ||
                    e?.name === "AbortException" ||
                    e?.name === "RenderingCancelledException"
                ) {
                    return;
                }
                if (mounted) setErr("PDF 로드 실패");
                // 콘솔 디버그용
                if (typeof console !== "undefined") console.debug("[PdfViewer] error:", e);
            }
        }

        load();

        return () => {
            mounted = false;
            try { loadingTask?.destroy?.(); } catch {}
            try { pdfDoc?.destroy?.(); } catch {}
        };
    }, [fileUrl, page, maxHeight]);

    return (
        <div style={{ width: "100%", display: "grid", placeItems: "center", maxHeight, overflow: "hidden" }}>
            {err ? (
                <div style={{ fontSize: 12, opacity: 0.7, padding: 8 }}>파일을 불러올 수 없습니다.</div>
            ) : (
                <canvas ref={canvasRef} />
            )}
        </div>
    );
}
