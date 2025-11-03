import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/build/pdf.worker.min.js"; // Vite + pdfjs 4.x에서 자동 번들되게 import

type Props = {
    fileUrl: string;   // Supabase Storage public URL
    page: number;      // 1-based
    className?: string;
};

export default function PdfViewer({ fileUrl, page, className }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const dpr = window.devicePixelRatio || 1;

        (async () => {
            try {
                setLoading(true);
                const pdf = await pdfjsLib.getDocument(fileUrl).promise;
                const p = Math.max(1, Math.min(page || 1, pdf.numPages));
                const pdfPage = await pdf.getPage(p);

                const viewport = pdfPage.getViewport({ scale: 1 });
                const scale = Math.min(1.8, (window.innerWidth * 0.9) / viewport.width); // 적당한 스케일
                const finalVp = pdfPage.getViewport({ scale });

                const canvas = canvasRef.current!;
                const ctx = canvas.getContext("2d")!;
                canvas.width = Math.floor(finalVp.width * dpr);
                canvas.height = Math.floor(finalVp.height * dpr);
                canvas.style.width = `${finalVp.width}px`;
                canvas.style.height = `${finalVp.height}px`;

                const renderContext = { canvasContext: ctx, viewport: finalVp, transform: [dpr, 0, 0, dpr, 0, 0] };
                await pdfPage.render(renderContext).promise;
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [fileUrl, page]);

    return (
        <div className={className} style={{ position: "relative" }}>
            {loading && <div style={{ position:"absolute", inset:0, display:"grid", placeItems:"center", opacity:.6 }}>로딩…</div>}
            <canvas ref={canvasRef} />
        </div>
    );
}
