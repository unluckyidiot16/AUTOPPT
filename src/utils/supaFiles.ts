// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/** presentations/* PDF → slides/* 디렉토리 프리픽스 계산 */
export function slidesPrefixOfPresentationsFile(fileKey?: string | null): string | null {
    if (!fileKey) return null;
    // 1) rooms/<room>/decks/<deck>/slides-TS.pdf
    let m = fileKey.match(/^presentations\/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;

    // 2) decks/<slug>/slides-TS.pdf  (업로더가 만드는 새 구조)
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    // 3) 혹시 과거 형태(파일명 다양) 대비
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    // 4) 이미 slides 경로를 넘겨준 경우(안전장치)
    m = fileKey.match(/^slides\/(.+)$/i);
    if (m) return m[1];

    return null;
}

/** decks.file_key(또는 presentations PDF key) + 페이지(1-base) → slides/* 내부 이미지 키(버킷 상대 경로) */
export function resolveSlidesKey(fileKey: string, page: number): string | null {
    // presentations/* 기준의 일반 케이스
    const prefix = slidesPrefixOfPresentationsFile(fileKey);
    if (prefix) return `${prefix}/${Math.max(0, page - 1)}.webp`;

    // 혹시 decks.file_key가 rooms/*/decks/*/slides-*.pdf 같은 DB 저장형인데
    // presentations/ 없이 넘어오는 경우도 커버
    let m = fileKey.match(/^rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}/${Math.max(0, page - 1)}.webp`;

    // 최후: 이미 슬라이드 경로를 받은 경우
    m = fileKey.match(/^decks\/([^/]+)\/?$/i);
    if (m) return `decks/${m[1]}/${Math.max(0, page - 1)}.webp`;

    return null;
}

/** slides/* 키 → 읽기 URL (우선 Signed, 실패 시 Public) */
export async function signedSlidesUrl(key: string, ttlSec = 1800): Promise<string | null> {
    const b = supabase.storage.from("slides");
    // signed
    try {
        const { data } = await b.createSignedUrl(key, ttlSec);
        if (data?.signedUrl) return data.signedUrl;
    } catch {}
    // public
    try {
        const { data } = await b.getPublicUrl(key);
        if (data?.publicUrl) return data.publicUrl;
    } catch {}
    return null;
}

/** 파일키 + 페이지(1-base) → WebP 이미지 URL */
export async function resolveWebpUrl(
    fileKey: string,
    page: number,
    opts?: { ttlSec?: number; cachebuster?: boolean },
): Promise<string | null> {
    const k = resolveSlidesKey(fileKey, page);
    if (!k) return null;
    const url = await signedSlidesUrl(k, opts?.ttlSec ?? 1800);
    if (!url) return null;
    return opts?.cachebuster ? `${url}&_=${Date.now()}` : url;
}
