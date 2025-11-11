// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

async function probeImage(url: string): Promise<boolean> {
      return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.decoding = "async";
            img.src = url;
          });
    }

/** 내부 유틸: 버킷 prefix 제거 */
function stripBucketPrefix(key: string, bucket: string) {
    return key.replace(new RegExp(`^${bucket}/`, "i"), "");
}

export function normalizeSlidesKey(key: string | null | undefined): string {
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key; // 이미 절대 URL이면 그대로
    return String(key).replace(/^\/+/, "").replace(/^slides\/+/i, "");
}

/** presentations/* PDF → slides/* 디렉토리 프리픽스 계산 (기존 함수) */
export function slidesPrefixOfPresentationsFile(fileKey?: string | null): string | null {
    if (!fileKey) return null;
    const rel = String(fileKey).replace(/^presentations\//i, "");

    // 0) 이미 slides 경로가 들어온 경우
    let m = fileKey.match(/^slides\/(.+)$/i);
    if (m) return m[1];

    // rooms/<room>/decks/<deck>/slides-TS.pdf
    m = fileKey.match(/^presentations\/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;

    m = fileKey.match(/^rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;

    // decks/<slug>/slides-TS.pdf
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    m = fileKey.match(/^decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    // 과거 형태: decks/<slug>/*.pdf
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    m = fileKey.match(/^decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;

    return null;
}

/** ✅ 어떤 형태의 키든 slides/* 프리픽스로 정규화 */
function slidesPrefixOfAny(fileKey?: string | null): string | null {
    if (!fileKey) return null;

    // 이미 slides prefix 또는 디렉터리 자체가 넘어오는 경우
    let m =
        fileKey.match(/^(?:slides\/)?(rooms\/[0-9a-f-]{36}\/decks\/[0-9a-f-]{36})(?:\/\d+\.webp)?$/i) ||
        fileKey.match(/^(?:slides\/)?(decks\/[^/]+)(?:\/\d+\.webp)?$/i);
    if (m) return m[1];

    // PDF 키라면 기존 규칙으로
    return slidesPrefixOfPresentationsFile(fileKey);
}

/** PDF 키에서 slides-타임스탬프 추출 (있으면) */
function slidesTimestampFromPdfKey(fileKey?: string | null): string | null {
      const m = String(fileKey ?? "").match(/slides-(\d+)\.pdf$/i);
      return m ? m[1] : null;
    }

/** 후보 프리픽스: (1) <deck> 루트, (2) <deck>/slides-TS (있으면) */
    function slidesCandidatePrefixes(fileKey?: string | null): string[] {
          const base = slidesPrefixOfAny(fileKey);
          if (!base) return [];
          const ts = slidesTimestampFromPdfKey(fileKey);
          return ts ? [base, `${base}/slides-${ts}`] : [base];
        }

/** decks.file_key(또는 presentations PDF key) + 페이지(1-base) → slides/* 내부 이미지 키 */
export function resolveSlidesKey(fileKey: string, page: number): string | null {
    const prefix = slidesPrefixOfAny(fileKey);
    if (!prefix) return null;
    return `${prefix}/${Math.max(0, page - 1)}.webp`;
}

/** slides/* 키 → 읽기 URL (Signed 우선, 실패 시 Public 폴백) */
export async function signedSlidesUrl(slidesKey: string, ttlSec = 1800): Promise<string> {
    const key = normalizeSlidesKey(slidesKey);
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key; // 절대 URL 그대로

    const { data } = await supabase.storage.from("slides").createSignedUrl(key, ttlSec);
    if (data?.signedUrl) return data.signedUrl;

    const { data: pub } = supabase.storage.from("slides").getPublicUrl(key);
    return pub.publicUrl || "";
}

/** 파일키 + 페이지(1-base) → WebP 이미지 URL */
export async function resolveWebpUrl(
    fileKey: string,
    page: number,
    opts?: { ttlSec?: number; cachebuster?: boolean },
): Promise<string | null> {
    const prefixes = slidesCandidatePrefixes(fileKey);
        if (!prefixes.length) return null;
        const n = Math.max(0, page - 1); // 1-base → 0-base
        for (const p of prefixes) {
                const key = `${p}/${n}.webp`;
                const url = await signedSlidesUrl(key, opts?.ttlSec ?? 1800);
                if (!url) continue;
                if (await probeImage(url)) return opts?.cachebuster ? `${url}&_=${Date.now()}` : url;
            }
        return null;
}

/** presentations 버킷의 PDF 키 → 읽기 URL (Signed 우선, Public 폴백) */
export async function getPdfUrlFromKey(
    fileKey: string,
    opts?: { ttlSec?: number; cachebuster?: boolean },
): Promise<string | null> {
    const rel = stripBucketPrefix(fileKey, "presentations");
    const b = supabase.storage.from("presentations");

    try {
        const { data } = await b.createSignedUrl(rel, opts?.ttlSec ?? 1800);
        if (data?.signedUrl) return opts?.cachebuster ? `${data.signedUrl}&_=${Date.now()}` : data.signedUrl;
    } catch {}
    try {
        const { data } = await b.getPublicUrl(rel);
        if (data?.publicUrl) return opts?.cachebuster ? `${data.publicUrl}&_=${Date.now()}` : data.publicUrl;
    } catch {}

    return null;
}
