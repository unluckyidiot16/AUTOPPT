// src/lib/pdfWorkerless.ts
// pdf.js: legacy 빌드 + 워커 미사용(브라우저/번들 충돌 회피)
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";

let primed = false;

/** 일부 환경은 disableWorker여도 workerSrc 문자열 검사 → 존재하는 CDN 경로로 세팅 */
export function primePdfWorkerless() {
    if (primed) return;
    const ver = (pdfjs as any).version || "4.8.69";
    // ⚠️ legacy 경로 (.js) — v4 계열에서 존재. (기존 build/… 는 404 원인)
    (pdfjs as any).GlobalWorkerOptions.workerSrc =
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/legacy/build/pdf.worker.min.js`;
    primed = true;
}

/** 워커 비활성으로 문서 열기 */
export async function openPdfWorkerless(src: ArrayBuffer | Uint8Array) {
    primePdfWorkerless();
    const task = (pdfjs as any).getDocument({
        data: src,
        disableWorker: true,
        isEvalSupported: false,
    });
    const doc = await task.promise;
    return doc as any; // { numPages, getPage(), destroy(), ... }
}
