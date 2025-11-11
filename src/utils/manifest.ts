// src/utils/manifest.ts (있으면 여기에 추가)
import type { ManifestItem } from "../types/manifest";

export function ensureManifestPages(totalPages: number): ManifestItem[] {
    return Array.from({length: totalPages}, (_,i)=>({
        type: "page",
        srcPage: i+1
    })) as ManifestItem[];
}