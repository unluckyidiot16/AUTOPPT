// src/lib/storageUrl.ts
import { supabase } from "../supabaseClient";

export async function toReadableUrl(fileKey: string, ttlSec = 3600 * 24) {
    // 1) 서명 URL
    const { data } = await supabase.storage.from("presentations").createSignedUrl(fileKey, ttlSec);
    if (data?.signedUrl) return data.signedUrl;
    // 2) 폴백(버킷이 public일 때)
    const { data: pub } = supabase.storage.from("presentations").getPublicUrl(fileKey);
    return pub.publicUrl ?? "";
}
