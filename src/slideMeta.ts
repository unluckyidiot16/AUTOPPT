// src/slideMeta.ts
export type StepMeta =
    | { kind: "show"; img?: string }
    | { kind: "quiz"; answer: string; auto?: boolean; img?: string };

export type SlideMeta = {
    slide: number;
    title?: string;
    steps: StepMeta[];
};

// 간단 캐시
let _slides: SlideMeta[] | null = null;

export async function loadSlides(): Promise<SlideMeta[]> {
    if (_slides) return _slides;
    // ✅ 하드코딩 대신 BASE_URL 사용
    const res = await fetch((import.meta.env.BASE_URL || "/") + "slides.json");
    const data = (await res.json()) as SlideMeta[];
    _slides = data;
    return data;
}
