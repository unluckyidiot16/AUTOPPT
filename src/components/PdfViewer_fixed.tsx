import React, { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerSrc;

type Props = {
    fileUrl: string;   // Supabase Storage public URL
    page: number;      // 1-based
    className?: string;
};

export default function PdfViewer({ fileUrl, page, className }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);
    const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

    // PDF 문서 로드 (fileUrl 변경 시에만)
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                setLoading(true);
                setError(null);
                
                // 기존 PDF 문서가 있으면 정리
                if (pdfDocRef.current) {
                    pdfDocRef.current.destroy();
                    pdfDocRef.current = null;
                }

                const pdf = await getDocument(fileUrl).promise;
                if (cancelled) {
                    pdf.destroy();
                    return;
                }
                
                pdfDocRef.current = pdf;
                setTotalPages(pdf.numPages);
                
                // 초기 페이지 렌더링
                await renderPage(pdf, page);
            } catch (err) {
                if (!cancelled) {
                    console.error("[PdfViewer] Error loading PDF:", err);
                    setError("PDF 로드 실패");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            if (pdfDocRef.current) {
                pdfDocRef.current.destroy();
                pdfDocRef.current = null;
            }
        };
    }, [fileUrl]);

    // 페이지 변경 시 렌더링 (page 변경 시에만)
    useEffect(() => {
        if (!pdfDocRef.current) return;
        
        (async () => {
            setLoading(true);
            try {
                await renderPage(pdfDocRef.current, page);
            } catch (err) {
                console.error("[PdfViewer] Error rendering page:", err);
                setError("페이지 렌더링 실패");
            } finally {
                setLoading(false);
            }
        })();
    }, [page]);

    const renderPage = async (pdf: PDFDocumentProxy, pageNum: number) => {
        if (!canvasRef.current) return;
        
        const dpr = window.devicePixelRatio || 1;
        
        // 페이지 번호 유효성 검사
        const validPageNum = Math.max(1, Math.min(pageNum || 1, pdf.numPages));
        console.log(`[PdfViewer] Rendering page ${validPageNum}/${pdf.numPages}`);
        
        const pdfPage = await pdf.getPage(validPageNum);
        
        const viewport = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(1.8, (window.innerWidth * 0.9) / viewport.width);
        const finalVp = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.error("[PdfViewer] Canvas context not available");
            return;
        }
        
        // 캔버스 크기 설정
        canvas.width = Math.floor(finalVp.width * dpr);
        canvas.height = Math.floor(finalVp.height * dpr);
        canvas.style.width = `${finalVp.width}px`;
        canvas.style.height = `${finalVp.height}px`;

        // 렌더링 컨텍스트 설정 및 렌더링
        const renderContext = { 
            canvasContext: ctx, 
            viewport: finalVp, 
            transform: [dpr, 0, 0, dpr, 0, 0] 
        };
        
        await pdfPage.render(renderContext).promise;
    };

    return (
        <div className={className} style={{ position: "relative" }}>
            {loading && (
                <div style={{ 
                    position: "absolute", 
                    inset: 0, 
                    display: "grid", 
                    placeItems: "center", 
                    background: "rgba(0,0,0,0.1)",
                    borderRadius: 8
                }}>
                    <div style={{ opacity: 0.6 }}>로딩 중...</div>
                </div>
            )}
            {error && (
                <div style={{ 
                    position: "absolute", 
                    inset: 0, 
                    display: "grid", 
                    placeItems: "center", 
                    color: "#ef4444" 
                }}>
                    {error}
                </div>
            )}
            <canvas ref={canvasRef} style={{ display: error ? 'none' : 'block' }} />
            {totalPages > 0 && !error && (
                <div style={{ 
                    position: "absolute", 
                    bottom: 8, 
                    right: 8, 
                    background: "rgba(0,0,0,0.7)", 
                    color: "#fff", 
                    padding: "4px 8px", 
                    borderRadius: 4,
                    fontSize: 12
                }}>
                    {page}/{totalPages}
                </div>
            )}
        </div>
    );
}
