// src/lib/pdfjs.ts  ✨ 전체 교체
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";

/** 공통 로더 */
export async function loadPdfJs() {
    return pdfjs;
}

/** 문서 열기 (항상 workerless) */
type OpenSrc = string | ArrayBuffer | Uint8Array;
type OpenOpts = Partial<{ withCredentials: boolean }>;

export function openPdf(src: OpenSrc, opts: OpenOpts = {}) {
    const base =
        typeof src === "string"
            ? { url: src, withCredentials: opts.withCredentials ?? false }
            : { data: src };
    return (pdfjs as any).getDocument({
        ...base,
        disableWorker: true,      // ✅ 중요한 한 줄
        isEvalSupported: false,   // Safari 등 안정성
    });
}
