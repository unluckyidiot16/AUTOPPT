// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/** 공통: 임의의 스토리지 키로 서명 URL 생성 (없으면 error) */
export async function getSignedUrlFromKey(
    key: string,
    { ttlSec = 1800, cachebuster = true }: { ttlSec?: number; cachebuster?: boolean } = {}
): Promise<string> {
    const { data, error } = await supabase.storage.from("presentations").createSignedUrl(key, ttlSec);
    if (error || !data?.signedUrl) throw error ?? new Error("signed url failed");
    const u = new URL(data.signedUrl);
    if (cachebuster) u.hash = `v=${Math.floor(Date.now() / 60000)}`;
    return u.toString();
}

/** 공통: public URL (버킷이 public일 때만 유효) */
export function getPublicUrlFromKey(
    key: string,
    { cachebuster = true }: { cachebuster?: boolean } = {}
): string {
    const raw = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
    const u = new URL(raw);
    if (cachebuster) u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
    return u.toString();
}

/** 기존 호환: PDF에 쓰던 함수 (남겨둠) */
export async function getPdfUrlFromKey(
    key: string,
    opts?: { ttlSec?: number; cachebuster?: boolean }
): Promise<string> {
    try {
        return await getSignedUrlFromKey(key, opts);
    } catch {
        return getPublicUrlFromKey(key, opts);
    }
}

/** presentations/* → slides/* 프리픽스 계산 (공용) */
export function slidesPrefixOfPresentationsFile(fileKey: string | null | undefined): string | null {
    if (!fileKey) return null;
    // 원본: presentations/decks/<slug>/slides-*.pdf → slides: decks/<slug>
    const m1 = fileKey.match(/^presentations\/decks\/([^/]+)/);
    if (m1) return `decks/${m1[1]}`;
    // 복제본: presentations/rooms/<room>/decks/<deckId>/slides-*.pdf → slides: rooms/<room>/decks/<deckId>
    const m2 = fileKey.match(/^presentations\/rooms\/([^/]+\/decks\/[^/]+)/);
    if (m2) return `rooms/${m2[1]}`;
    return null;
}

/** PDF file_key + page → 가능한 WebP 키 후보들을 생성 (presentations 버킷 쪽 후보) */
export function buildWebpKeyCandidates(pdfKey: string, page: number): string[] {
    const base = pdfKey.replace(/\.pdf$/i, "").replace(/\/+$/, "");
    const n = String(page);
    const n3 = n.padStart(3, "0");
    const n4 = n.padStart(4, "0");
    return [
        `${base}/${n}.webp`,
        `${base}/${n3}.webp`,
        `${base}/${n4}.webp`,
        `${base}-p${n}.webp`,
        `${base}-${n}.webp`,
        `${base}-${n3}.webp`,
        `${base}-${n4}.webp`,
        `${base}/page-${n}.webp`,
        `${base}/slide-${n}.webp`,
    ];
}

/** 존재하는 WebP를 찾으면 URL 반환 (slides 0-base 우선 → presentations 폴백) */
export async function resolveWebpUrl(
    pdfKey: string,
    page: number,
    { ttlSec = 1800, cachebuster = true }: { ttlSec?: number; cachebuster?: boolean } = {}
): Promise<string | null> {
    // 1) slides 버킷(0-base) 우선
    const sp = slidesPrefixOfPresentationsFile(pdfKey);
    const slidesCandidates = sp ? [`${sp}/${Math.max(0, page - 1)}.webp`] : [];
    for (const k of slidesCandidates) {
        try {
            const { data, error } = await supabase.storage.from("slides").createSignedUrl(k, ttlSec);
            if (!error && data?.signedUrl) {
                const u = new URL(data.signedUrl);
                if (cachebuster) u.hash = `v=${Math.floor(Date.now() / 60000)}`;
                return u.toString();
            }
        } catch { /* next */ }
    }
    if (slidesCandidates.length) {
        try {
            const raw = supabase.storage.from("slides").getPublicUrl(slidesCandidates[0]).data.publicUrl;
            const u = new URL(raw);
            if (cachebuster) u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
            return u.toString();
        } catch { /* fall through */ }
    }

    // 2) (호환) presentations 버킷 후보들(보통 1-base 명명)
    const candidates = buildWebpKeyCandidates(pdfKey, page);
    for (const k of candidates) {
        try {
            const { data, error } = await supabase.storage.from("presentations").createSignedUrl(k, ttlSec);
            if (!error && data?.signedUrl) {
                const u = new URL(data.signedUrl);
                if (cachebuster) u.hash = `v=${Math.floor(Date.now() / 60000)}`;
                return u.toString();
            }
        } catch { /* next */ }
    }
    try {
        const first = candidates[0];
        return getPublicUrlFromKey(first, { cachebuster });
    } catch {
        return null;
    }
}
