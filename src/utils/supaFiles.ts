// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/* ============================================================================
 * DEBUG (주소창에 ?debugSlides=1 붙이면 상세 로그 출력)
 * ==========================================================================*/
const DEBUG =
    typeof window !== "undefined" &&
    /(?:\?|&)debugSlides=1\b/i.test(window.location.search);
function dlog(...args: any[]) {
    if (DEBUG) console.warn("[slides]", ...args);
}

/* --------------------------------- utils ---------------------------------- */
function withSlash(p: string) {
    return p.endsWith("/") ? p : `${p}/`;
}
function stripBucketPrefix(key: string, bucket: string) {
    return key.replace(new RegExp(`^${bucket}/`, "i"), "");
}

/** slides 키 정규화 (절대 URL은 그대로) */
export function normalizeSlidesKey(key: string | null | undefined): string {
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key;
    return String(key).replace(/^\/+/, "").replace(/^slides\/+/i, "");
}

/* ------------------------- pdf key → room/deck/ts ------------------------- */
type PdfCtx = {
    roomId?: string | null;
    deckId?: string | null;
    ts?: string | null;
    raw: string;
};
/** presentations/rooms/.../decks/.../slides-TS.pdf → 컨텍스트 추출 */
function parsePdfCtx(fileKey?: string | null): PdfCtx {
    const raw = String(fileKey ?? "");

    // rooms/<rid>/decks/<did>/slides-<ts>.pdf
    {
        const m = raw.match(
            /rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-(\d+)\.pdf$/i
        );
        if (m) return { roomId: m[1], deckId: m[2], ts: m[3], raw };
    }
    // decks/<slug|uuid>/slides-<ts>.pdf
    {
        const m = raw.match(/decks\/([^/]+)\/slides-(\d+)\.pdf$/i);
        if (m) return { roomId: null, deckId: m[1], ts: m[2], raw };
    }
    // 과거: decks/<slug|uuid>/*.pdf
    {
        const m = raw.match(/decks\/([^/]+)\/[^/]+\.pdf$/i);
        if (m) return { roomId: null, deckId: m[1], ts: null, raw };
    }
    return { roomId: null, deckId: null, ts: null, raw };
}

/** 표준/과거/실수형까지 포괄하는 기본 prefix 후보들 생성 */
function baseCandidatesFromCtx(ctx: PdfCtx): string[] {
    const out: string[] = [];
    // 표준
    if (ctx.roomId && ctx.deckId) out.push(`rooms/${ctx.roomId}/decks/${ctx.deckId}`);
    // rooms/ 빠진 케이스
    if (ctx.roomId && ctx.deckId) out.push(`${ctx.roomId}/decks/${ctx.deckId}`);
    // 라이브러리형
    if (ctx.deckId) out.push(`decks/${ctx.deckId}`);
    // 실수형(중첩 decks)
    if (ctx.roomId && ctx.deckId)
        out.push(`rooms/${ctx.roomId}/decks/${ctx.deckId}/decks`);
    return Array.from(new Set(out));
}

/** presentations/* PDF → slides/* 프리픽스 계산 (외부에서도 사용) */
export function slidesPrefixOfPresentationsFile(
    fileKey?: string | null
): string | null {
    if (!fileKey) return null;

    // 이미 slides 경로
    {
        const m = fileKey.match(/^slides\/(.+)$/i);
        if (m) return m[1];
    }

    // rooms/<rid>/decks/<did>/slides-TS.pdf
    {
        const m = fileKey.match(
            /^presentations\/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i
        );
        if (m) return `rooms/${m[1]}/decks/${m[2]}`;
    }
    // rooms/<rid>/decks/<did>/slides-TS.pdf (presentations/ 없이 넘어오는 경우)
    {
        const m = fileKey.match(
            /^rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i
        );
        if (m) return `rooms/${m[1]}/decks/${m[2]}`;
    }

    // decks/<slug|uuid>/slides-TS.pdf
    {
        const m =
            fileKey.match(
                /^presentations\/decks\/([^/]+)\/slides-[^/]+\.pdf$/i
            ) || fileKey.match(/^decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
        if (m) return `decks/${m[1]}`;
    }

    // 과거: decks/<slug|uuid>/*.pdf
    {
        const m =
            fileKey.match(
                /^presentations\/decks\/([^/]+)\/[^/]+\.pdf$/i
            ) || fileKey.match(/^decks\/([^/]+)\/[^/]+\.pdf$/i);
        if (m) return `decks/${m[1]}`;
    }
    return null;
}

/** 어떤 입력이 와도 slides/* 프리픽스로 정규화 (PDF/디렉터리/파일 모두) */
export function slidesPrefixOfAny(fileKey?: string | null): string | null {
    if (!fileKey) return null;

    // 이미 slides 디렉터리/파일 형태
    {
        const m =
            fileKey.match(
                /^(?:slides\/)?(rooms\/[0-9a-f-]{36}\/decks\/[0-9a-f-]{36})(?:\/\d+\.webp)?$/i
            ) ||
            fileKey.match(/^(?:slides\/)?(decks\/[^/]+)(?:\/\d+\.webp)?$/i) ||
            fileKey.match(
                /^(?:slides\/)?([0-9a-f-]{36}\/decks\/[0-9a-f-]{36})(?:\/\d+\.webp)?$/i
            );
        if (m) return m[1];
    }

    // PDF 키에서 유도
    return slidesPrefixOfPresentationsFile(fileKey);
}

/** PDF 키에서 slides-타임스탬프 추출 */
function slidesTimestampFromPdfKey(fileKey?: string | null): string | null {
    const m = String(fileKey ?? "").match(/slides-(\d+)\.pdf$/i);
    return m ? m[1] : null;
}

/** 후보 프리픽스: <deck> 루트 + (있으면) <deck>/slides-TS */
function slidesCandidatePrefixes(fileKey?: string | null): string[] {
    const base = slidesPrefixOfAny(fileKey);
    if (!base) return [];
    const ts = slidesTimestampFromPdfKey(fileKey);
    const out = ts ? [base, `${base}/slides-${ts}`] : [base];
    dlog("candidates(from key)", { fileKey, prefixes: out });
    return out;
}

/* -------------------------- storage existence check ----------------------- */
/** 파일 존재 확인 (Storage.list 기반 → 이미지 프리로드 의존 X) */
async function existsInSlides(key: string): Promise<boolean> {
    const k = normalizeSlidesKey(key);
    const dir = k.replace(/\/[^/]+$/, "");
    const name = k.split("/").pop()!;
    const { data, error } = await supabase.storage
        .from("slides")
        .list(withSlash(dir), { limit: 1, search: name });
    if (DEBUG && error) dlog("exists:list error", { key: k, error });
    return !!(data && data.length > 0);
}

/* ------------------------------- URL helpers ------------------------------ */
/** slides/* 키 → 읽기 URL (signed 우선, 실패시 public) */
export async function signedSlidesUrl(
    slidesKey: string,
    ttlSec = 1800
): Promise<string> {
    const key = normalizeSlidesKey(slidesKey);
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key;

    // 존재하지 않으면 바로 빈 문자열
    const ok = await existsInSlides(key);
    if (!ok) return "";

    try {
        const { data } = await supabase.storage
            .from("slides")
            .createSignedUrl(key, ttlSec);
        if (data?.signedUrl) return data.signedUrl;
    } catch {
        /* noop */
    }
    const { data: pub } = supabase.storage.from("slides").getPublicUrl(key);
    return pub.publicUrl || "";
}

/* -------------------------- main resolution function ---------------------- */
/**
 * 파일키 + 페이지(1-base) → WebP URL
 * - 썸네일과 동일한 로직
 * - 후보(prefixes) 탐색 → 존재 확인 → 서명 URL 반환
 * - ?debugSlides=1 에서 상세 로그 출력
 */
export async function resolveWebpUrl(
    fileKey: string,
    page: number,
    opts?: { ttlSec?: number; cachebuster?: boolean }
): Promise<string | null> {
    const n = Math.max(0, page - 1);

    // 이미 slides/*.webp 형태가 들어온 경우
    if (/^slides\/.+\.webp$/i.test(fileKey)) {
        const url = await signedSlidesUrl(
            normalizeSlidesKey(fileKey),
            opts?.ttlSec ?? 1800
        );
        dlog("direct-webp", { fileKey, page, url });
        return url ? (opts?.cachebuster ? `${url}&_=${Date.now()}` : url) : null;
    }

    const prefixes = slidesCandidatePrefixes(fileKey);
    const tried: Array<{ key: string; exists: boolean; url: string }> = [];

    for (const p of prefixes) {
        const key = `${p}/${n}.webp`;
        const exists = await existsInSlides(key);
        if (!exists) {
            tried.push({ key, exists, url: "" });
            continue;
        }

        const url = await signedSlidesUrl(key, opts?.ttlSec ?? 1800);
        tried.push({ key, exists: true, url });
        if (url) {
            const finalUrl = opts?.cachebuster ? `${url}&_=${Date.now()}` : url;
            dlog("RESOLVED ✅", { fileKey, page, chosen: key, url: finalUrl, tried });
            return finalUrl;
        }
    }

    dlog("RESOLVE FAILED ❌", { fileKey, page, tried });
    return null;
}

/** (편의) fileKey + page → slides/* 내부의 정규화된 경로 문자열 */
export function resolveSlidesKey(fileKey: string, page: number): string | null {
    const prefix = slidesPrefixOfAny(fileKey);
    if (!prefix) return null;
    return `${prefix}/${Math.max(0, page - 1)}.webp`;
}

/* --------------------------- (참고) PDF URL helper ------------------------ */
export async function getPdfUrlFromKey(
    fileKey: string,
    opts?: { ttlSec?: number; cachebuster?: boolean }
): Promise<string | null> {
    const rel = stripBucketPrefix(fileKey, "presentations");
    const b = supabase.storage.from("presentations");
    try {
        const { data } = await b.createSignedUrl(rel, opts?.ttlSec ?? 1800);
        if (data?.signedUrl)
            return opts?.cachebuster ? `${data.signedUrl}&_=${Date.now()}` : data.signedUrl;
    } catch {
        /* noop */
    }
    const { data } = await b.getPublicUrl(rel);
    if (data?.publicUrl)
        return opts?.cachebuster ? `${data.publicUrl}&_=${Date.now()}` : data.publicUrl;
    return null;
}

/* ------------------------------ Debug helper ------------------------------ */
/**
 * 콘솔 진단 도우미
 * window.__slidesProbe('<fileKey>', 1) 로 호출
 */
export async function __slidesProbe(fileKey: string, page = 1) {
    const prefixes = slidesCandidatePrefixes(fileKey);
    const n = Math.max(0, page - 1);
    const attempts = await Promise.all(
        prefixes.map(async (p) => {
            const key = `${p}/${n}.webp`;
            try {
                const exists = await existsInSlides(key);
                const url = exists ? await signedSlidesUrl(key, 120) : "";
                return { key, exists, url };
            } catch (e) {
                return { key, exists: false, url: "", err: String(e) };
            }
        })
    );
    // 표 형태 출력
    // eslint-disable-next-line no-console
    console.table(attempts);
    return { fileKey, page, prefixes, attempts };
}

if (typeof window !== "undefined") {
    (window as any).__slidesProbe = __slidesProbe;
}
