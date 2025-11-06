// src/utils/pdfPageCounter.ts
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// @ts-ignore
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

let WORKER_BOUND = false;
function ensureWorker() {
    if (!WORKER_BOUND) {
        const w = new PdfJsWorker();
        GlobalWorkerOptions.workerPort = w;
        // @ts-ignore
        (globalThis as any).__autoppt_pdf_worker = w;
        WORKER_BOUND = true;
    }
}

/**
 * PDF 파일의 실제 페이지 수를 가져오는 함수
 * @param fileUrl - PDF 파일의 서명된 URL
 * @returns 페이지 수
 */
export async function getPdfPageCountFromUrl(fileUrl: string): Promise<number> {
    try {
        ensureWorker();
        
        const loadingTask = getDocument({ 
            url: fileUrl, 
            withCredentials: false 
        });
        
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;
        
        // 메모리 정리
        await pdf.destroy();
        
        return pageCount;
    } catch (error) {
        console.error("Failed to get PDF page count:", error);
        // 오류 발생 시 기본값 반환
        return 10;
    }
}

/**
 * Supabase storage의 file key로부터 페이지 수를 가져오는 함수
 * @param supabase - Supabase 클라이언트
 * @param fileKey - Storage의 파일 경로
 * @returns 페이지 수
 */
export async function getPdfPageCountFromKey(
    supabase: any, 
    fileKey: string
): Promise<number> {
    try {
        // 먼저 DB에서 기존 정보 확인
        const { data: existingDeck } = await supabase
            .from("decks")
            .select("file_pages")
            .eq("file_key", fileKey)
            .maybeSingle();
        
        if (existingDeck?.file_pages && existingDeck.file_pages > 0) {
            return existingDeck.file_pages;
        }
        
        // 서명된 URL 생성
        const { data: signedData, error: signError } = await supabase.storage
            .from("presentations")
            .createSignedUrl(fileKey, 60); // 1분 유효
        
        if (signError || !signedData?.signedUrl) {
            console.error("Failed to create signed URL:", signError);
            return 10;
        }
        
        // PDF 페이지 수 계산
        const pageCount = await getPdfPageCountFromUrl(signedData.signedUrl);
        
        return pageCount;
    } catch (error) {
        console.error("Failed to get PDF page count from key:", error);
        return 10;
    }
}
