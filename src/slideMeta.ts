// src/slideMeta.ts
import { getBasePath } from "./utils/getBasePath";

export type SlideStep = {
    kind?: "quiz" | "image" | "text";
    img?: string;
    [k: string]: any;
};

export type SlideMeta = {
    slide: number;            // 1-based
    steps: SlideStep[];
};

let _slides: SlideMeta[] | null = null;

export async function loadSlides(): Promise<SlideMeta[]> {
    if (_slides) return _slides;
    const base = getBasePath(); // ← GitHub Pages 서브패스 대응
    const res = await fetch(`${base}/slides.json`);
    const data = (await res.json()) as SlideMeta[];
    _slides = Array.isArray(data) ? data : [];
    return _slides;
}
