// src/api/overrides.ts
import { supabase } from "../supabaseClient";

export async function getManifestByRoom(roomCode: string) {
    const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
    if (error) throw error;

    const slots = (data?.slots ?? []) as any[];
    const first = slots[0] ?? null;
    const slides = (first?.slides ?? []) as any[];

    const items = slides.map((s: any, i: number) => {
        const kind = s.kind === "material" ? "page" : s.kind;   // material → page
        const id = String(
            s.id ??
            `${s.material_id ?? "mat"}:${Number.isFinite(s.page_index) ? s.page_index : i}`
        );
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

export async function upsertManifest(roomCode: string, deckId: string, items: any[]) {
    console.warn("[overrides.upsertManifest] TODO: lesson_slides 재배치 / slide_overlays upsert", { roomCode, deckId, items });
    return { ok: true };
}
