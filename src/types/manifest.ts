export type ManifestPageItem = { type: "page"; srcPage: number };

export type ManifestItem = ManifestPageItem | ManifestQuizItem;

export function defaultManifest(totalPages: number): ManifestItem[] {
    const n = Math.max(0, Number(totalPages) || 0);
    return Array.from({ length: n }, (_, i) => ({ type: "page", srcPage: i + 1 }));
}

export type QuizQuestion = {
    id: string;
    prompt: string;
    keywords: string[];        // 정답 키워드들
    options?: string[];        // (선택) 객관식 보기
};

export type ManifestQuizItem = {
    type: "quiz";
    srcPage: number;           // 같은 페이지에 복수 문제 가능
    questions: QuizQuestion[]; // ✅ 복수 문제
    layout?: "panel" | "popup";
};