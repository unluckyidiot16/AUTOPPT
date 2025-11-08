// src/lib/pdfWorkerless.ts
// pdf.js: legacy 빌드 + 워커 미사용(브라우저/번들 충돌 회피)
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";

let _ready = false;

/** 한번만 workerSrc를 '유효한 문자열'로 세팅 (실행은 workerless) */
function ensurePdfReady() {
    if (_ready) return;
    const ver = (pdfjs as any).version || "4.8.69";
    // 일부 환경은 disableWorker여도 workerSrc 문자열 검사 → CDN 문자열 지정
    (pdfjs as any).GlobalWorkerOptions.workerSrc =
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`;
    _ready = true;
}

/** pdf.js 워커 경로만 미리 세팅(실행은 여전히 workerless) */
export function primePdfWorkerless() {
    ensurePdfReady();
}

/** 워커 비활성으로 문서 열기 */
export async function openPdfWorkerless(src: ArrayBuffer | Uint8Array) {
    ensurePdfReady();
    const task = (pdfjs as any).getDocument({
        data: src,
        disableWorker: true,
        isEvalSupported: false,
    });
    const doc = await task.promise;
    return doc as any; // { numPages, getPage(), destroy(), ... }
}
