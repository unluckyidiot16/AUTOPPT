// src/lib/pdfjs.ts
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// ① 전역 워커 경로(필요 시에만 쓰임)
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ② 공통 로더
export async function loadPdfJs() {
    return pdfjs;
}

// ③ 문서 열기 헬퍼 (worker/workerless 선택)
type OpenSrc = string | ArrayBuffer | Uint8Array;
type OpenOpts = Partial<{
    disableWorker: boolean;
    withCredentials: boolean;
}>;
export function openPdf(src: OpenSrc, opts: OpenOpts = {}) {
    const base =
        typeof src === "string"
            ? { url: src, withCredentials: opts.withCredentials ?? false }
            : { data: src };
    return (pdfjs as any).getDocument({ ...base, disableWorker: !!opts.disableWorker });
}
