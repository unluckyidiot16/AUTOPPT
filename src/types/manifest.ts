export type ManifestPageItem = { type: "page"; srcPage: number };
export type ManifestQuizItem = {
    type: "quiz";
    prompt: string;
    keywords: string[];
    threshold?: number;     // 기본 1
    autoAdvance?: boolean;  // 기본 false (권장: off)
};
export type ManifestItem = ManifestPageItem | ManifestQuizItem;

export function defaultManifest(totalPages: number): ManifestItem[] {
    const n = Math.max(0, Number(totalPages) || 0);
    return Array.from({ length: n }, (_, i) => ({ type: "page", srcPage: i + 1 }));
}
