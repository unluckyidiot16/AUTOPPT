// src/lib/pdfjs.ts
export async function loadPdfJs() {
    try {
        const pdf = await import("pdfjs-dist/legacy/build/pdf");   // 호환성 ↑
        try { (pdf as any).GlobalWorkerOptions.workerSrc = undefined; (pdf as any).GlobalWorkerOptions.workerPort = undefined as any; } catch {}
        return pdf;
    } catch {
        const pdf = await import("pdfjs-dist/build/pdf");           // 최후의 보루
        try { (pdf as any).GlobalWorkerOptions.workerSrc = undefined; (pdf as any).GlobalWorkerOptions.workerPort = undefined as any; } catch {}
        return pdf;
    }
}
