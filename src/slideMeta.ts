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
    const res = await fetch("/AUTOPPT/slides.json"); // base에 맞게 조정
    const data = (await res.json()) as SlideMeta[];
    _slides = data;
    return data;
}
