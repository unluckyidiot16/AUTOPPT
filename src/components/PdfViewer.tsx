// src/components/PdfViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// IMPORTANT: pdfjs-dist v4 (ESM only). Use a real Worker instance.
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

// Bind a dedicated worker (works in Vite/React/TS)
const worker = new PdfJsWorker();
GlobalWorkerOptions.workerPort = worker;

type Props = {
  fileUrl: string;   // Supabase Storage public URL
  page: number;      // 1-based page index
  className?: string;
  maxHeight?: string | number;
};

/**
 * Robust PDF viewer for pdfjs-dist v4 in Vite.
 * - Uses module worker via GlobalWorkerOptions.workerPort
 * - Re-renders on page change, container resize, and DPR changes
 * - Cleans up render tasks and document instances
 */
export default function PdfViewer({ fileUrl, page, className, maxHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);

  // Track device pixel ratio so we can re-render crisply on zoom changes
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const [pixelRatio, setPixelRatio] = useState(dpr);

  // ---- Load PDF when fileUrl changes ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTotalPages(0);

    (async () => {
      try {
        // Cancel any on-going render from the previous document
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch {}
          renderTaskRef.current = null;
        }
        // Dispose previous document
        if (pdfRef.current) {
          try { await pdfRef.current.destroy(); } catch {}
          pdfRef.current = null;
        }

        const pdf = await getDocument({ url: fileUrl, withCredentials: false }).promise;
        if (cancelled) { try { await pdf.destroy(); } catch {}; return; }
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError("PDF 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [fileUrl]);

  // ---- Render current page whenever page / size / DPR or pdf changes ----
  const renderPage = useMemo(() => {
    return async () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const pdf = pdfRef.current;
      if (!canvas || !container || !pdf) return;

      // Validate page number
      const targetPage = Math.max(1, Math.min(page || 1, pdf.numPages));
      const pdfPage: PDFPageProxy = await pdf.getPage(targetPage);

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      // Compute viewport based on available container width
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const containerWidth = Math.max(320, container.clientWidth || 0);
      const scaleByWidth = (containerWidth - 16) / baseViewport.width; // small padding
      const scale = Math.max(0.25, Math.min(scaleByWidth, 2.0));        // clamp
      const viewport = pdfPage.getViewport({ scale });

      // Account for high-DPI displays
      const ratio = pixelRatio;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const transform = ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] as any : undefined;

      // Cancel any previous render task
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }

      renderTaskRef.current = pdfPage.render({
        canvasContext: ctx,
        viewport,
        transform,
        intent: "display",
      });

      try {
        await renderTaskRef.current.promise;
      } catch {
        /* ignore cancellations */
      } finally {
        renderTaskRef.current = null;
      }
    };
  }, [page, pixelRatio]);

  // Re-render when dependencies change
  useEffect(() => {
    renderPage();
  }, [renderPage, totalPages]);

  // Re-render on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => { renderPage(); });
    obs.observe(container);
    return () => obs.disconnect();
  }, [renderPage]);

  // Track DPR changes (zoom/monitor move)
  useEffect(() => {
    const onChange = () => setPixelRatio(window.devicePixelRatio || 1);
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    // Fallback: listen to window resize too
    window.addEventListener("resize", onChange);
    // Some browsers don't fire matchMedia reliably for DPR; the resize fallback is enough.
    return () => {
      window.removeEventListener("resize", onChange);
      try { mq.removeEventListener?.("change", onChange as any); } catch {}
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { renderTaskRef.current?.cancel(); } catch {}
      renderTaskRef.current = null;
      if (pdfRef.current) {
        try { pdfRef.current.destroy(); } catch {}
        pdfRef.current = null;
      }
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
