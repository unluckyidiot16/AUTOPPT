// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

/** presentations/rooms/.../decks/.../slides-TS.pdf → rooms/.../decks/.../slides-TS/ */
export function slidesPrefixOfPresentationsFile(fileKey?: string | null): string | null {
    if (!fileKey) return null;
    const rel = String(fileKey).replace(/^presentations\//i, "");
    const m = rel.match(/^(rooms\/[^/]+\/decks\/[^/]+\/slides-\d+)\.pdf$/i);
    return m ? `${m[1]}/` : null;
}

/** slides 버킷의 서명 URL 생성 */
export async function signedSlidesUrl(prefix: string, page: number, expiresSec = 300) {
    if (!prefix || page < 1) return null;
    const key = `${prefix.replace(/^\/+/, "")}${page}.webp`; // e.g. rooms/.../slides-TS/1.webp
    const { data, error } = await supabase.storage.from("slides").createSignedUrl(key, expiresSec);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
}

/** decks.file_key + page → slides 버킷의 webp 서명 URL */
export async function resolveWebpUrl(fileKey: string, page: number) {
    if (!fileKey || page < 1) return null;
    const prefix =
        slidesPrefixOfPresentationsFile(fileKey) ??
        slidesPrefixOfPresentationsFile(`presentations/${fileKey}`);
    if (!prefix) return null;
    return await signedSlidesUrl(prefix, page);
}

/** (자료함에서 사용) presentations 버킷의 PDF 공개 URL */
export function getPdfUrlFromKey(fileKey: string) {
    const key = String(fileKey).replace(/^presentations\//i, "");
    const { data } = supabase.storage.from("presentations").getPublicUrl(key);
    return data.publicUrl;
}
