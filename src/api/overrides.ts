// src/api/manifest.ts
import { supabase } from "../supabaseClient";

export type Overlay = { id: string; z: number; type: string; payload: any };
export type Slide = {
    index: number;
    kind: "material" | "quiz" | "blank" | "break";
    material_id: string | null;
    page_index: number | null;
    image_key: string | null; // slides 버킷 내부 경로
    overlays: Overlay[];
};
export type SlotBundle = { slot: number; lesson_id: string; current_index: number; slides: Slide[] };
export type StudentManifest = { room_code: string; slots: SlotBundle[]; error?: string };

export async function fetchStudentManifest(roomCode: string): Promise<StudentManifest> {
    const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
    if (error) throw error;
    return data as StudentManifest;
}

export function publicSlideUrl(image_key: string) {
    return supabase.storage.from("slides").getPublicUrl(image_key).data.publicUrl;
}
