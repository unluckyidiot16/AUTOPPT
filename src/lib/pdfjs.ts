// src/lib/pdfjs.ts
let pdfjsLib: any = null;

export async function loadPdfJs() {
    // 이미 로드되었으면 재사용
    if (pdfjsLib) return pdfjsLib;

    try {
        // legacy 빌드 시도 (더 안정적)
        const pdf: any = await import("pdfjs-dist/legacy/build/pdf");

        // GlobalWorkerOptions 완전 비활성화 - 빈 문자열로 설정해야 함
        if (pdf.GlobalWorkerOptions) {
            pdf.GlobalWorkerOptions.workerSrc = '';  // undefined가 아닌 빈 문자열!
            pdf.GlobalWorkerOptions.workerPort = null;
        }

        // getDocument 메서드 오버라이드 - 모든 호출에 disableWorker 강제
        const originalGetDocument = pdf.getDocument.bind(pdf);
        pdf.getDocument = (src: any) => {
            // src가 문자열이면 객체로 변환
            const options = (typeof src === 'string')
                ? { url: src, disableWorker: true }
                : { ...src, disableWorker: true };

            // 추가 안전 옵션
            options.verbosity = 0;  // 로그 최소화

            return originalGetDocument(options);
        };

        pdfjsLib = pdf;
        console.log('[pdfjs] Loaded legacy build in workerless mode');
        return pdf;

    } catch (legacyError) {
        console.warn('[pdfjs] Legacy build failed, trying standard build:', legacyError);

        try {
            // 표준 빌드 폴백
            const pdf: any = await import("pdfjs-dist/build/pdf");

            // GlobalWorkerOptions 완전 비활성화
            if (pdf.GlobalWorkerOptions) {
                pdf.GlobalWorkerOptions.workerSrc = '';  // 빈 문자열!
                pdf.GlobalWorkerOptions.workerPort = null;
            }

            // getDocument 메서드 오버라이드
            const originalGetDocument = pdf.getDocument.bind(pdf);
            pdf.getDocument = (src: any) => {
                const options = (typeof src === 'string')
                    ? { url: src, disableWorker: true }
                    : { ...src, disableWorker: true };

                options.verbosity = 0;
                return originalGetDocument(options);
            };

            pdfjsLib = pdf;
            console.log('[pdfjs] Loaded standard build in workerless mode');
            return pdf;

        } catch (standardError) {
            console.error('[pdfjs] Both builds failed:', standardError);

            // 최후의 수단: window 객체에서 찾기
            if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
                const pdf = (window as any).pdfjsLib;
                if (pdf.GlobalWorkerOptions) {
                    pdf.GlobalWorkerOptions.workerSrc = '';
                }
                pdfjsLib = pdf;
                return pdf;
            }

            throw new Error('Failed to load PDF.js');
        }
    }
}

// 유틸리티: PDF 문서를 안전하게 열기
export async function openPdfDocument(source: string | ArrayBuffer | Uint8Array): Promise<any> {
    const pdf = await loadPdfJs();

    // 항상 disableWorker: true로 열기
    const loadingTask = pdf.getDocument({
        data: source,
        disableWorker: true,
        verbosity: 0
    });

    return await loadingTask.promise;
}

// 디버깅용: PDF.js 상태 확인
export async function checkPdfJsStatus() {
    try {
        const pdf = await loadPdfJs();
        const status = {
            loaded: !!pdf,
            hasGetDocument: !!pdf?.getDocument,
            workerSrc: pdf?.GlobalWorkerOptions?.workerSrc,
            workerPort: pdf?.GlobalWorkerOptions?.workerPort,
            version: pdf?.version || 'unknown'
        };
        console.table(status);
        return status;
    } catch (error) {
        console.error('PDF.js status check failed:', error);
        return null;
    }
}