// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";
export function slidesPrefixOfAny(key?: string | null): string | null {
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key; // (거의 안 씀)
    const k = key.replace(/^slides\//i, "").replace(/^\/+/, "");
    // 이미 slides prefix?
    if (/^(rooms\/[^/]+\/decks\/[^/]+|decks\/[^/]+)$/i.test(k)) return k;
    // presentations → decks / rooms/decks
    const m1 = k.match(/^presentations\/decks\/([^/]+)\/[^/]+$/i);
    if (m1) return `decks/${m1[1]}`;
    const m2 = k.match(/^presentations\/rooms\/([a-f0-9-]+)\/decks\/([a-f0-9-]+)\/[^/]+$/i);
    if (m2) return `rooms/${m2[1]}/decks/${m2[2]}`;
    return null;
}

export function normalizeSlidesKey(key?: string | null): string | null {
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key;
    return key.replace(/^slides\//i, "").replace(/^\/+/, "");
}

export async function signedSlidesUrl(path: string, ttlSec = 1800): Promise<string> {
    const key = path.replace(/^slides\//i, "");
    const { data } = await supabase.storage.from("slides").createSignedUrl(key, ttlSec);
    if (data?.signedUrl) return data.signedUrl;
    const { data: pub } = supabase.storage.from("slides").getPublicUrl(key);
    return pub.publicUrl;
}

/** fileKeyOrPrefix(=slides prefix) + page(1-base) → 서명 URL */
export async function resolveWebpUrl(fileKeyOrPrefix: string, page: number, opts?: { ttlSec?: number; cachebuster?: boolean }): Promise<string> {
    const prefix = slidesPrefixOfAny(fileKeyOrPrefix) ?? fileKeyOrPrefix;
    const idx0 = Math.max(0, Number(page) - 1);
    const url = await signedSlidesUrl(`${prefix}/${idx0}.webp`, opts?.ttlSec ?? 1800);
    if (opts?.cachebuster) {
        const u = new URL(url); u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
        return u.toString();
    }
    return url;
}
