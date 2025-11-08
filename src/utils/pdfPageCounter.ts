// src/utils/pdfPageCounter.ts
import { getDocument } from "pdfjs-dist";

/**
 * PDF 파일의 실제 페이지 수를 가져오는 함수
 * @param fileUrl - PDF 파일의 서명된 URL
 * @returns 페이지 수
 */
export async function getPdfPageCountFromUrl(fileUrl: string): Promise<number> {
    try {
        const loadingTask = getDocument({
            url: fileUrl,
            withCredentials: false,
            disableWorker: true,        // ✅ 워커 비활성 (빌드 충돌 회피)
        });
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;
        await pdf.destroy();          // 메모리 정리
        return pageCount;
    } catch (error) {
        console.error("Failed to get PDF page count:", error);
        return 10; // 안전 기본값
    }
}

/**
 * Supabase storage의 file key로부터 페이지 수를 가져오는 함수
 */
export async function getPdfPageCountFromKey(
    supabase: any,
    fileKey: string
): Promise<number> {
    try {
        // 1) DB 캐시 우선
        const { data: existingDeck } = await supabase
            .from("decks")
            .select("file_pages")
            .eq("file_key", fileKey)
            .maybeSingle();

        if (existingDeck?.file_pages && existingDeck.file_pages > 0) {
            return existingDeck.file_pages;
        }

        // 2) 서명 URL 생성 (✅ 상대키로!)
        const rel = fileKey.replace(/^presentations\//, "");
        const { data: signedData, error: signError } = await supabase.storage
            .from("presentations")
            .createSignedUrl(rel, 60); // 1분 유효

        if (signError || !signedData?.signedUrl) {
            console.error("Failed to create signed URL:", signError);
            return 10;
        }

        // 3) 페이지 수 계산 (워커 비활성)
        const pageCount = await getPdfPageCountFromUrl(signedData.signedUrl);
        return pageCount;
    } catch (error) {
        console.error("Failed to get PDF page count from key:", error);
        return 10;
    }
}
