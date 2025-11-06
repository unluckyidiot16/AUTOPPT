// src/api/overrides.ts
import { supabase } from "../supabaseClient";

export async function getManifestByRoom(roomCode: string) {
    const { data, error } = await supabase.rpc("get_student_manifest_by_code", {
        p_room_code: roomCode,
    });
    if (error) throw error;

    const slots = (data?.slots ?? []) as any[];
    const first = slots[0] ?? null;
    const slides = (first?.slides ?? []) as any[];

    // 구(舊) 에디터가 다루기 쉬운 최소 형태로 정규화
    const items = slides.map((s: any) => ({
        // DeckEditor가 key로 쓸 수 있도록 고정 id 제공(없으면 index 사용)
        id: String(s.index ?? `${s.material_id ?? "x"}:${s.page_index ?? "x"}`),
        // Path2: material 슬라이드는 'page'로 표기, 그 외(kind)는 그대로
        type: s.kind === "material" ? "page" : s.kind,
        material_id: s.material_id ?? null,
        page_index: s.page_index ?? null,
        image_key: s.image_key ?? null,
        overlays: Array.isArray(s.overlays) ? s.overlays : [],
    }));

    return {
        // 에디터가 사용할 목록
        items,
        // 참고용 메타
        slot: first?.slot ?? 1,
        lesson_id: first?.lesson_id ?? null,
        total: items.length,
        // 원본도 함께 반환(필요 시 에디터에서 접근)
        raw: data,
    };
}

export async function upsertManifest(roomCode: string, payload: any) {
    console.warn("[overrides.upsertManifest] Path2 저장 로직 미구현 - payload:", payload);
    // TODO: lesson_slides 재배치 / slide_overlays upsert 로직 추가
    return { ok: true };
}
