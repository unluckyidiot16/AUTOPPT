// src/utils/supaFiles.ts
import { supabase } from "../supabaseClient";

export async function getPdfUrlFromKey(
    key: string,
    { ttlSec = 1800, cachebuster = true }: { ttlSec?: number; cachebuster?: boolean } = {}
): Promise<string> {
    // 1) 서명 URL
    try {
        const { data, error } = await supabase.storage.from("presentations").createSignedUrl(key, ttlSec);
        if (!error && data?.signedUrl) {
            const u = new URL(data.signedUrl);
            if (cachebuster) u.hash = `v=${Math.floor(Date.now() / 60000)}`; // ← hash로
            return u.toString();
        }
    } catch {/* noop */}

    // 2) public URL (버킷이 public일 때만 유효)
    const raw = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
    const u = new URL(raw);
    if (cachebuster) u.searchParams.set("v", String(Math.floor(Date.now() / 60000))); // public엔 query
    return u.toString();
}
