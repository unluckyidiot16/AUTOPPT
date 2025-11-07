// src/lib/pdfjs.ts  (full replace)
type PdfAny = any;

function wrapWithDisableWorker(pdf: PdfAny): PdfAny {
    // 1) 전역 워커 경로/포트 무효화(있다면)
    try {
        pdf.GlobalWorkerOptions.workerSrc = undefined;
        pdf.GlobalWorkerOptions.workerPort = undefined as any;
    } catch {}
    // 2) getDocument만 안전하게 래핑 (모듈 객체는 읽기 전용이라 대입 X)
    return new Proxy(pdf, {
        get(target, prop, receiver) {
            if (prop === "getDocument") {
                const orig = Reflect.get(target, prop, receiver);
                return (src: any) => {
                    const opts = src && typeof src === "object" ? { ...src, disableWorker: true }
                        : { url: src, disableWorker: true };
                    return orig(opts);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

export async function loadPdfJs(): Promise<PdfAny> {
    try {
        const legacy = await import("pdfjs-dist/legacy/build/pdf");
        return wrapWithDisableWorker(legacy as PdfAny);
    } catch {
        const std = await import("pdfjs-dist/build/pdf");
        return wrapWithDisableWorker(std as PdfAny);
    }
}
