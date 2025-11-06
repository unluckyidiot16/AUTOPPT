// src/hooks/usePdfPrefetch.ts
import { useEffect, useRef } from "react";
// 타입 의존성은 선택사항입니다. (안 맞으면 제거해도 동작엔 문제 없음)
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";

export function usePdfPrefetch(pdfDoc: PDFDocumentProxy | null, currentPage: number) {
    const cacheRef = useRef<Map<number, PDFPageProxy>>(new Map());

    // 문서가 바뀌면 캐시 비우기
    useEffect(() => {
        return () => {
            cacheRef.current.forEach((p) => p.cleanup?.());
            cacheRef.current.clear();
        };
    }, [pdfDoc]);

    useEffect(() => {
        if (!pdfDoc) return;
        let cancelled = false;

        async function prefetch(n: number) {
            if (!pdfDoc || cancelled) return;
            if (n < 1 || n > (pdfDoc as any).numPages) return;
            if (cacheRef.current.has(n)) return;
            try {
                const page = await pdfDoc.getPage(n);
                if (cancelled) { page?.cleanup?.(); return; }
                cacheRef.current.set(n, page);
                // 렌더는 하지 않고, getPage()만으로 파싱/리소스 로드 선행
            } catch {
                // 무시 (프리패치 실패는 치명적이지 않음)
            }
        }

        prefetch(currentPage - 1);
        prefetch(currentPage + 1);

        // 캐시를 3페이지 이내로 유지 (현재±1 외는 제거)
        const keep = new Set([currentPage - 1, currentPage + 1]);
        for (const k of Array.from(cacheRef.current.keys())) {
            if (!keep.has(k)) {
                cacheRef.current.get(k)?.cleanup?.();
                cacheRef.current.delete(k);
            }
        }

        return () => { cancelled = true; };
    }, [pdfDoc, currentPage]);
}
