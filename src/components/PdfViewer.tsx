// src/components/PdfViewer.tsx
import React, { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import "pdfjs-dist/legacy/web/pdf_viewer.css";

// 워커 (고정 버전 사용)
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.js";

type Props = {
    fileUrl: string;
    page: number;        // 1-base
    maxHeight?: number;  // 선택
};

export default function PdfViewer({ fileUrl, page, maxHeight }: Props) {
    const holderRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pdfRef = useRef<any>(null);
    const lastUrlRef = useRef<string | null>(null);
    const renderTokenRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            // 문서 캐시: URL이 바뀌면 새로 로드
            if (!pdfRef.current || lastUrlRef.current !== fileUrl) {
                lastUrlRef.current = fileUrl;
                try {
                    pdfRef.current?.destroy?.();
                } catch {}
                const task = (pdfjsLib as any).getDocument({ url: fileUrl, withCredentials: false });
                pdfRef.current = await task.promise;
                if (cancelled) return;
            }

            const token = ++renderTokenRef.current;
            const pdf = pdfRef.current;
            const pageObj = await pdf.getPage(Math.max(1, page));
            if (cancelled || token !== renderTokenRef.current) return;

            // 렌더링 크기 계산(컨테이너 폭 기준)
            const canvas = canvasRef.current!;
            const holder = holderRef.current!;
            const vp1 = pageObj.getViewport({ scale: 1 });
            const targetWidth = Math.min(holder.clientWidth || 800, vp1.width);
            const scale = targetWidth / vp1.width;

            const vp = pageObj.getViewport({ scale });
            canvas.width = Math.ceil(vp.width);
            canvas.height = Math.ceil(vp.height);

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // 흰 배경
            ctx.save();
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();

            await pageObj.render({ canvasContext: ctx, viewport: vp }).promise;
        })();

        return () => { cancelled = true; };
    }, [fileUrl, page]);

    return (
        <div ref={holderRef} style={{ width: "100%", maxHeight, overflow: maxHeight ? "auto" : "visible" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
    );
}
