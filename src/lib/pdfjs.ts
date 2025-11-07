// src/lib/pdfjs.ts
export async function loadPdfJs() {
    try {
        const pdf: any = await import("pdfjs-dist/legacy/build/pdf");
        try {
            // 모든 호출에 대해 disableWorker 강제 주입
            const orig = pdf.getDocument;
            pdf.getDocument = (src: any) => {
                const opts = (src && typeof src === "object") ? src : { url: src };
                return orig({ ...opts, disableWorker: true });
            };
            pdf.GlobalWorkerOptions.workerSrc = undefined;
            pdf.GlobalWorkerOptions.workerPort = undefined as any;
        } catch {}
        return pdf;
    } catch {
        const pdf: any = await import("pdfjs-dist/build/pdf");
        try {
            const orig = pdf.getDocument;
            pdf.getDocument = (src: any) => {
                const opts = (src && typeof src === "object") ? src : { url: src };
                return orig({ ...opts, disableWorker: true });
            };
            pdf.GlobalWorkerOptions.workerSrc = undefined;
            pdf.GlobalWorkerOptions.workerPort = undefined as any;
        } catch {}
        return pdf;
    }
}
