// src/components/PdfViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, PDFDocumentLoadingTask } from "pdfjs-dist";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

// Bind a dedicated worker once
const worker = new PdfJsWorker();
GlobalWorkerOptions.workerPort = worker;

type Props = {
    fileUrl: string | null | undefined; // ← null 방어
    page: number;                        // 1-based
    className?: string;
    maxHeight?: string | number;
};

export default function PdfViewer({ fileUrl, page, className, maxHeight }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const pdfRef = useRef<PDFDocumentProxy | null>(null);
    const loadingTaskRef = useRef<PDFDocumentLoadingTask<any> | null>(null);
    const renderTaskRef = useRef<RenderTask | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState(0);

    const [pixelRatio, setPixelRatio] = useState(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

    // ---- Load PDF only when fileUrl changes ----
    useEffect(() => {
        let cancelled = false;

        // Guard: invalid URL → 바로 종료(폴백/플레이스홀더용)
        if (!fileUrl) {
            setLoading(false);
            setError("자료가 없습니다");
            setTotalPages(0);
            // 이미 열려 있던 것들 정리
            try { renderTaskRef.current?.cancel(); } catch {}
            renderTaskRef.current = null;
            (async () => {
                try { await loadingTaskRef.current?.destroy(); } catch {}
                loadingTaskRef.current = null;
                try { await pdfRef.current?.destroy(); } catch {}
                pdfRef.current = null;
            })();
            return () => {};
        }

        setLoading(true);
        setError(null);
        setTotalPages(0);

        (async () => {
            // 1) 이전 작업 모두 중단
            try { renderTaskRef.current?.cancel(); } catch {}
            renderTaskRef.current = null;
            try { await loadingTaskRef.current?.destroy(); } catch {}
            loadingTaskRef.current = null;
            try { await pdfRef.current?.destroy(); } catch {}
            pdfRef.current = null;

            // 2) 새 문서 로딩 태스크 시작(※ 나중에 확실히 destroy)
            const task = getDocument({ url: fileUrl, withCredentials: false });
            loadingTaskRef.current = task;

            try {
                const pdf = await task.promise;
                if (cancelled) { try { await pdf.destroy(); } catch {}; return; }
                pdfRef.current = pdf;
                setTotalPages(pdf.numPages);
                setError(null);
            } catch (e) {
                if (!cancelled) setError("PDF 로드 실패");
            } finally {
                loadingTaskRef.current = null;
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [fileUrl]);

    // ---- Render current page whenever page / DPR or pdf changes ----
    const renderPage = useMemo(() => {
        return async () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            const pdf = pdfRef.current;
            if (!canvas || !container || !pdf) return;

            const clamped = Math.max(1, Math.min(page || 1, pdf.numPages));
            const pdfPage: PDFPageProxy = await pdf.getPage(clamped);

            const ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) return;

            const baseViewport = pdfPage.getViewport({ scale: 1 });
            const containerWidth = Math.max(320, container.clientWidth || 0);
            const scaleByWidth = (containerWidth - 16) / baseViewport.width;
            const scale = Math.max(0.25, Math.min(scaleByWidth, 2.0));
            const viewport = pdfPage.getViewport({ scale });

            const ratio = pixelRatio;
            canvas.width = Math.floor(viewport.width * ratio);
            canvas.height = Math.floor(viewport.height * ratio);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;

            const transform = ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] as any : undefined;

            // 기존 렌더 태스크 취소
            try { renderTaskRef.current?.cancel(); } catch {}
            renderTaskRef.current = pdfPage.render({ canvasContext: ctx, viewport, transform, intent: "display" });

            try {
                await renderTaskRef.current.promise;
            } catch {
                // cancel 예외는 무시
            } finally {
                renderTaskRef.current = null;
            }
        };
    }, [page, pixelRatio]);

    // kick render
    useEffect(() => { renderPage(); }, [renderPage, totalPages]);

    // Re-render on container resize
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const obs = new ResizeObserver(() => { renderPage(); });
        obs.observe(container);
        return () => obs.disconnect();
    }, [renderPage]);

    // DPR tracking
    useEffect(() => {
        const onChange = () => setPixelRatio(window.devicePixelRatio || 1);
        window.addEventListener("resize", onChange);
        return () => { window.removeEventListener("resize", onChange); };
    }, []);

    // Final cleanup on unmount
    useEffect(() => {
        return () => {
            try { renderTaskRef.current?.cancel(); } catch {}
            renderTaskRef.current = null;
            (async () => {
                try { await loadingTaskRef.current?.destroy(); } catch {}
                loadingTaskRef.current = null;
                try { await pdfRef.current?.destroy(); } catch {}
                pdfRef.current = null;
            })();
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                position: "relative",
                width: "100%",
                maxHeight: maxHeight ?? "unset",
                overflow: "auto",
                background: "#0b1220",
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
            }}
        >
            {loading && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#94a3b8" }}>
                    로딩 중...
                </div>
            )}
            {error && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#ef4444" }}>
                    {error}
                </div>
            )}
            <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />
            {totalPages > 0 && (
                <div
                    aria-label="page-indicator"
                    style={{
                        position: "absolute",
                        bottom: 8,
                        right: 8,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                    }}
                >
                    {page}/{totalPages}
                </div>
            )}
        </div>
    );
}
