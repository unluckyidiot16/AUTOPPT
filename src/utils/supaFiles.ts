// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/** 내부 유틸: 버킷 prefix 제거 */
function stripBucketPrefix(key: string, bucket: string) {
    return key.replace(new RegExp(`^${bucket}/`, "i"), "");
}

/** presentations/* PDF → slides/* 디렉토리 프리픽스 계산 */
export function slidesPrefixOfPresentationsFile(fileKey?: string | null): string | null {
    if (!fileKey) return null;

    // 1) rooms/<room>/decks/<deck>/slides-TS.pdf
    let m = fileKey.match(/^presentations\/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;

    // 2) decks/<slug>/slides-TS.pdf (새 업로더 기본)
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    // 3) 과거 형태(파일명 자유)
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    // 4) 이미 slides 경로가 들어온 경우
    m = fileKey.match(/^slides\/(.+)$/i);
    if (m) return m[1];

    return null;
}

/** decks.file_key(또는 presentations PDF key) + 페이지(1-base) → slides/* 내부 이미지 키 */
export function resolveSlidesKey(fileKey: string, page: number): string | null {
    const prefix = slidesPrefixOfPresentationsFile(fileKey);
    if (prefix) return `${prefix}/${Math.max(0, page - 1)}.webp`;

    // presentations/ 없이 DB에 저장된 rooms/* 패턴도 방어
    let m = fileKey.match(/^rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}/${Math.max(0, page - 1)}.webp`;

    // 최후: slides 프리픽스만 넘어온 경우
    m = fileKey.match(/^decks\/([^/]+)\/?$/i);
    if (m) return `decks/${m[1]}/${Math.max(0, page - 1)}.webp`;

    return null;
}

/** slides/* 키 → 읽기 URL (우선 Signed, 실패 시 Public) */
export async function signedSlidesUrl(key: string, ttlSec = 1800): Promise<string | null> {
    const b = supabase.storage.from("slides");
    try {
        const { data } = await b.createSignedUrl(key, ttlSec);
        if (data?.signedUrl) return data.signedUrl;
    } catch {}
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

/** ✅ 복구: presentations 버킷의 PDF 키 → 읽기 URL (Signed 우선, Public 폴백) */
export async function getPdfUrlFromKey(
    fileKey: string,
    opts?: { ttlSec?: number; cachebuster?: boolean },
): Promise<string | null> {
    // fileKey가 'presentations/...' 또는 버킷상 상대키 둘 다 허용
    const rel = stripBucketPrefix(fileKey, "presentations");
    const b = supabase.storage.from("presentations");

    // 1) signed url
    try {
        const { data } = await b.createSignedUrl(rel, opts?.ttlSec ?? 1800);
        if (data?.signedUrl) {
            return opts?.cachebuster ? `${data.signedUrl}&_=${Date.now()}` : data.signedUrl;
        }
    } catch {}

    // 2) public url
    try {
        const { data } = await b.getPublicUrl(rel);
        if (data?.publicUrl) {
            return opts?.cachebuster ? `${data.publicUrl}&_=${Date.now()}` : data.publicUrl;
        }
    } catch {}

    return null;
}
