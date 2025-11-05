import React, { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerSrc;

type Props = {
    fileUrl: string;   // Supabase Storage public URL
    page: number;      // 1-based
    className?: string;
    maxHeight?: string | number;  // 최대 높이 제한 옵션
};

export default function PdfViewer({ fileUrl, page, className, maxHeight }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number>(0);
    const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
    const currentPageRef = useRef<number>(page);

    // PDF 문서 로드 (fileUrl 변경 시에만)
    useEffect(() => {
        let cancelled = false;
        
        console.log(`[PdfViewer] Loading PDF: ${fileUrl}`);

        (async () => {
            try {
                setLoading(true);
                setError(null);
                
                // 기존 PDF 문서가 있으면 정리
                if (pdfDocRef.current) {
                    console.log(`[PdfViewer] Destroying previous PDF document`);
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
                console.log(`[PdfViewer] PDF loaded successfully. Total pages: ${pdf.numPages}`);
                
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
                console.log(`[PdfViewer] Cleaning up PDF document`);
                pdfDocRef.current.destroy();
                pdfDocRef.current = null;
            }
        };
    }, [fileUrl]);

    // 페이지 변경 시 렌더링
    useEffect(() => {
        if (!pdfDocRef.current) return;
        if (currentPageRef.current === page) return; // 같은 페이지면 스킵
        
        currentPageRef.current = page;
        console.log(`[PdfViewer] Page changed to ${page}`);
        
        (async () => {
            setLoading(true);
            try {
                await renderPage(pdfDocRef.current!, page);
            } catch (err) {
                console.error("[PdfViewer] Error rendering page:", err);
                setError("페이지 렌더링 실패");
            } finally {
                setLoading(false);
            }
        })();
    }, [page]);

    const renderPage = async (pdf: PDFDocumentProxy, pageNum: number) => {
        if (!canvasRef.current || !containerRef.current) return;
        
        const dpr = window.devicePixelRatio || 1;
        
        // 페이지 번호 유효성 검사
        const validPageNum = Math.max(1, Math.min(pageNum || 1, pdf.numPages));
        console.log(`[PdfViewer] Rendering page ${validPageNum}/${pdf.numPages}`);
        
        const pdfPage = await pdf.getPage(validPageNum);
        
        // 컨테이너 크기 기준으로 스케일 계산
        const containerWidth = containerRef.current.clientWidth || 800;
        const viewport = pdfPage.getViewport({ scale: 1 });
        
        // 너비에 맞춰 스케일 계산 (패딩 고려)
        const scale = Math.min(1.5, (containerWidth - 20) / viewport.width);
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
        console.log(`[PdfViewer] Page ${validPageNum} rendered successfully`);
    };

    const containerStyle: React.CSSProperties = {
        position: "relative",
        width: "100%",
        maxHeight: maxHeight || "600px",
        overflow: "auto",
        backgroundColor: "#f3f4f6",
        borderRadius: 8,
        padding: 10,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start"
    };

    return (
        <div 
            ref={containerRef}
            className={className} 
            style={containerStyle}
        >
            {loading && (
                <div style={{ 
                    position: "absolute", 
                    inset: 0, 
                    display: "grid", 
                    placeItems: "center", 
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 8,
                    zIndex: 10
                }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ marginBottom: 8 }}>로딩 중...</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>페이지 {page}</div>
                    </div>
                </div>
            )}
            {error && (
                <div style={{ 
                    position: "absolute", 
                    inset: 0, 
                    display: "grid", 
                    placeItems: "center", 
                    color: "#ef4444",
                    background: "rgba(255,255,255,0.9)",
                    borderRadius: 8
                }}>
                    {error}
                </div>
            )}
            <canvas 
                ref={canvasRef} 
                style={{ 
                    display: error ? 'none' : 'block',
                    maxWidth: "100%",
                    height: "auto"
                }} 
            />
            {totalPages > 0 && !error && !loading && (
                <div style={{ 
                    position: "absolute", 
                    bottom: 8, 
                    right: 8, 
                    background: "rgba(0,0,0,0.7)", 
                    color: "#fff", 
                    padding: "4px 8px", 
                    borderRadius: 4,
                    fontSize: 12,
                    zIndex: 5
                }}>
                    {page}/{totalPages}
                </div>
            )}
        </div>
    );
}
