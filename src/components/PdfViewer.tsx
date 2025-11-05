// src/components/PdfViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import "pdfjs-dist/legacy/web/pdf_viewer.css";

// ✅ 라이브러리 버전에 맞춰 워커 버전도 자동 일치
const ver = (pdfjsLib as any).version || "4.6.82";
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`;

type Props = { fileUrl: string; page: number; maxHeight?: number };

export default function PdfViewer({ fileUrl, page, maxHeight }: Props) {
    const holderRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pdfRef = useRef<any>(null);
    const lastUrlRef = useRef<string | null>(null);
    const renderTokenRef = useRef(0);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setErr(null);
                // 문서 캐시: URL이 바뀌면 새로 로드
                if (!pdfRef.current || lastUrlRef.current !== fileUrl) {
                    lastUrlRef.current = fileUrl;
                    try { pdfRef.current?.destroy?.(); } catch {}
                    const task = (pdfjsLib as any).getDocument({ url: fileUrl, withCredentials: false });
                    pdfRef.current = await task.promise;
                    if (cancelled) return;
                }

                const token = ++renderTokenRef.current;
                const pdf = pdfRef.current;
                const pageObj = await pdf.getPage(Math.max(1, page));
                if (cancelled || token !== renderTokenRef.current) return;

                const canvas = canvasRef.current!;
                const holder = holderRef.current!;
                const vp1 = pageObj.getViewport({ scale: 1 });

                const targetWidth = Math.max(1, holder.clientWidth || 800);
                const scale = Math.min(1, targetWidth / vp1.width);
                const vp = pageObj.getViewport({ scale });

                canvas.width = Math.ceil(vp.width);
                canvas.height = Math.ceil(vp.height);

                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.save();
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();

                await pageObj.render({ canvasContext: ctx, viewport: vp }).promise;
            } catch (e) {
                console.error("[PdfViewer] render error:", e);
                setErr("PDF를 불러오지 못했습니다.");
            }
        })();
        return () => { cancelled = true; };
    }, [fileUrl, page]);

    return (
        <div ref={holderRef} style={{ width: "100%", maxHeight, overflow: maxHeight ? "auto" : "visible" }}>
            {err ? <div style={{ padding: 8, fontSize: 12, opacity: .7 }}>{err}</div>
                : <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />}
        </div>
    );
}
