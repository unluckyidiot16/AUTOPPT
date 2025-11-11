// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/* ============================================================================
 * DEBUG 스위치 (주소창에 ?debugSlides=1 붙이면 상세 로그)
 * ==========================================================================*/
const DEBUG = typeof window !== "undefined" && /(?:\?|&)debugSlides=1\b/i.test(window.location.search);
function dlog(...args: any[]) { if (DEBUG) console.debug("[slides]", ...args); }

/* ------------------------------- small utils ------------------------------ */
function stripBucketPrefix(key: string, bucket: string) {
    return key.replace(new RegExp(`^${bucket}/`, "i"), "");
}
export function normalizeSlidesKey(key: string | null | undefined): string {
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key;
    return String(key).replace(/^\/+/, "").replace(/^slides\/+/i, "");
}
function withSlash(p: string) { return p.endsWith("/") ? p : `${p}/`; }

/* ------------------------- pdf key → room/deck/ts ------------------------- */
type PdfCtx = { roomId?: string | null; deckId?: string | null; ts?: string | null; raw: string };
function parsePdfCtx(fileKey?: string | null): PdfCtx {
    const raw = String(fileKey ?? "");
    const a = raw.match(/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-(\d+)\.pdf$/i);
    if (a) return { roomId: a[1], deckId: a[2], ts: a[3], raw };
    const b = raw.match(/decks\/([^/]+)\/slides-(\d+)\.pdf$/i);
    if (b) return { roomId: null, deckId: b[1], ts: b[2], raw };

    // 과거 형태: decks/<slug>/*.pdf
    const c = raw.match(/decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (c) return { roomId: null, deckId: c[1], ts: null, raw };

    return { roomId: null, deckId: null, ts: null, raw };
}

/* ---------------------------- prefix candidates --------------------------- */
// 주 경로 규칙: rooms/<roomId>/decks/<deckId>   (+ /slides-<ts> 하위)
function baseCandidatesFromCtx(ctx: PdfCtx): string[] {
    const out: string[] = [];

    // 표준
    if (ctx.roomId && ctx.deckId) out.push(`rooms/${ctx.roomId}/decks/${ctx.deckId}`);

    // 과거/오류 저장 보정: rooms/ 빠진 케이스
    if (ctx.roomId && ctx.deckId) out.push(`${ctx.roomId}/decks/${ctx.deckId}`);

    // slug/uuid만 있는 케이스 (라이브러리형)
    if (ctx.deckId) out.push(`decks/${ctx.deckId}`);

    // 중첩 decks/ 가 들어간 실수 케이스까지 (보수적으로)
    if (ctx.roomId && ctx.deckId) out.push(`rooms/${ctx.roomId}/decks/${ctx.deckId}/decks`);

    // 중복 제거
    return Array.from(new Set(out));
}

function slidesCandidatePrefixes(fileKey?: string | null): string[] {
    if (!fileKey) return [];
    // 이미 slides/* 디렉터리가 들어온 경우
    let m: RegExpMatchArray | null =
        fileKey.match(/^(?:slides\/)?(rooms\/[0-9a-f-]{36}\/decks\/[0-9a-f-]{36})(?:\/\d+\.webp)?$/i) ||
        fileKey.match(/^(?:slides\/)?(decks\/[^/]+)(?:\/\d+\.webp)?$/i) ||
        fileKey.match(/^(?:slides\/)?([0-9a-f-]{36}\/decks\/[0-9a-f-]{36})(?:\/\d+\.webp)?$/i);
    if (m) return [m[1]];

    // PDF 키에서 파싱
    const ctx = parsePdfCtx(fileKey);
    const bases = baseCandidatesFromCtx(ctx);
    // TS 변형 포함
    const tsBases = ctx.ts ? bases.map(b => `${b}/slides-${ctx.ts}`) : [];
    const out = [...bases, ...tsBases];
    dlog("candidates(from key)", { fileKey, ctx, bases: out });
    return out;
}

/* -------------------------- storage existence check ----------------------- */
// 파일 존재 확인(디렉토리 list로 확인 → CORS/브라우저 preload 의존 X)
async function existsInSlides(key: string): Promise<boolean> {
    const k = normalizeSlidesKey(key);
    const dir = k.replace(/\/[^/]+$/, "");
    const name = k.split("/").pop()!;
    const { data, error } = await supabase.storage.from("slides").list(withSlash(dir), { limit: 1, search: name });
    if (DEBUG && error) dlog("exists:list error", { key: k, error });
    return !!(data && data.length > 0);
}

/* ------------------------------- URL helpers ------------------------------ */
export async function signedSlidesUrl(slidesKey: string, ttlSec = 1800): Promise<string> {
    const key = normalizeSlidesKey(slidesKey);
    if (!key) return "";
    if (/^https?:\/\//i.test(key)) return key;

    // 없으면 URL 안 돌려줌
    const ok = await existsInSlides(key);
    if (!ok) return "";

    // Public 버킷이라도 signed 우선 (만료/권한 일관성)
    try {
        const { data } = await supabase.storage.from("slides").createSignedUrl(key, ttlSec);
        if (data?.signedUrl) return data.signedUrl;
    } catch {}
    const { data: pub } = supabase.storage.from("slides").getPublicUrl(key);
    return pub.publicUrl || "";
}

/* -------------------------- main resolution function ---------------------- */
/** 파일키 + 페이지(1-base) → WebP URL (존재검사 + 후보 탐색 + 상세로그) */
export async function resolveWebpUrl(
    fileKey: string,
    page: number,
    opts?: { ttlSec?: number; cachebuster?: boolean },
): Promise<string | null> {
    const n = Math.max(0, page - 1);

    // 이미 slides/*.webp가 직접 들어오면 그대로 처리
    if (/^slides\/.+\.webp$/i.test(fileKey)) {
        const url = await signedSlidesUrl(normalizeSlidesKey(fileKey), opts?.ttlSec ?? 1800);
        dlog("direct-webp", { fileKey, page, url });
        return url ? (opts?.cachebuster ? `${url}&_=${Date.now()}` : url) : null;
    }

    const prefixes = slidesCandidatePrefixes(fileKey);
    const tried: Array<{ key: string; exists: boolean; url: string }> = [];

    for (const p of prefixes) {
        const key = `${p}/${n}.webp`;
        const exists = await existsInSlides(key);
        if (!exists) { tried.push({ key, exists, url: "" }); continue; }

        const url = await signedSlidesUrl(key, opts?.ttlSec ?? 1800);
        tried.push({ key, exists: true, url });
        if (url) {
            dlog("RESOLVED ✅", { fileKey, page, chosen: key, url, tried });
            return opts?.cachebuster ? `${url}&_=${Date.now()}` : url;
        }
    }

    dlog("RESOLVE FAILED ❌", { fileKey, page, tried });
    return null;
}

/* --------------------------- (참고) PDF URL helper ------------------------ */
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
    const { data } = await b.getPublicUrl(rel);
    if (data?.publicUrl) return opts?.cachebuster ? `${data.publicUrl}&_=${Date.now()}` : data.publicUrl;
    return null;
}

/* ----------------------------- (옵션) exporter ---------------------------- */
export function slidesPrefixOfPresentationsFile(fileKey?: string | null): string | null {
    if (!fileKey) return null;
    const rel = String(fileKey).replace(/^presentations\//i, "");
    let m = fileKey.match(/^slides\/(.+)$/i);
    if (m) return m[1];
    m = fileKey.match(/^presentations\/rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;
    m = fileKey.match(/^rooms\/([0-9a-f-]{36})\/decks\/([0-9a-f-]{36})\/slides-[^/]+\.pdf$/i);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    m = fileKey.match(/^decks\/([^/]+)\/slides-[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    m = fileKey.match(/^presentations\/decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    m = fileKey.match(/^decks\/([^/]+)\/[^/]+\.pdf$/i);
    if (m) return `decks/${m[1]}`;
    return null;
}
