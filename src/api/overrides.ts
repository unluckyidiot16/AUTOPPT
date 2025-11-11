// src/api/overrides.ts
import { supabase } from "../supabaseClient";
import { slidesPrefixOfAny } from "../utils/supaFiles";

export async function getManifestByRoom(roomCode: string) {
    const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
    if (error) throw error;

    const slots = (data?.slots ?? []) as any[];
    const first = slots[0] ?? null;
    const slides = (first?.slides ?? []) as any[];

    const items = slides.map((s: any, i: number) => {
        const kind = s.kind === "material" ? "page" : s.kind; // material → page
        const id = String(s.id ?? `${s.material_id ?? "mat"}:${Number.isFinite(s.page_index) ? s.page_index : i}`);
        return {
            id,
            type: kind,
            material_id: s.material_id ?? null,
            page_index: s.page_index ?? null,
            image_key: s.image_key ?? null,
            overlays: Array.isArray(s.overlays) ? s.overlays : [],
        };
    });

    return {
        items,
        slot: first?.slot ?? 1,
        lesson_id: first?.lesson_id ?? null,
        total: items.length,
        raw: data,
    };
}

/**
 * 저장 규칙
 * 1) 가능하면 DB RPC 사용: upsert_manifest_by_room(p_room_code, p_deck_id, p_items)
 * 2) 없으면 스토리지 폴백: slides/<prefix>/manifest.json
 */
export async function upsertManifest(roomCode: string, deckId: string, items: any[]) {
    // 1) RPC 시도 (있으면 사용)
    try {
        const { error } = await supabase.rpc("upsert_manifest_by_room", {
            p_room_code: roomCode,
            p_deck_id: deckId,
            p_items: items,
        } as any);
        if (!error) return { ok: true, via: "rpc" as const };
    } catch {
        // ignore → storage fallback
    }

    // 2) 스토리지 폴백
    const row = await supabase.from("decks").select("file_key").eq("id", deckId).maybeSingle();
    const fileKey = row.data?.file_key as string | undefined;
    if (!fileKey) return { ok: false, reason: "deck.file_key not found" };

    const prefix = slidesPrefixOfAny(fileKey);
    if (!prefix) return { ok: false, reason: "slides prefix not resolvable" };

    const path = `${prefix}/manifest.json`;
    const b = supabase.storage.from("slides");
    const body = new Blob([JSON.stringify({ items }, null, 2)], { type: "application/json" });

    const up = await b.upload(path, body, { upsert: true, contentType: "application/json" });
    if (up.error) return { ok: false, reason: up.error.message };

    return { ok: true, via: "storage" as const, key: `slides/${path}` };
}
