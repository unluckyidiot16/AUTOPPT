// src/utils/pdfPageCounter.ts
import { getDocument } from "pdfjs-dist";
export async function getPdfPageCountFromUrl(fileUrl: string): Promise<number> {
    try {
        const loadingTask = getDocument({
            url: fileUrl,
            withCredentials: false,
            disableWorker: true,   // ✅ workerless
        });
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;
        await pdf.destroy();
        return pageCount;
    } catch (e) {
        console.error("Failed to get PDF page count:", e);
        return 10;
    }
}