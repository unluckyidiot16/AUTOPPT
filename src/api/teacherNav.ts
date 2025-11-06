// src/api/teacherNav.ts
import { supabase } from "../supabaseClient";

export async function gotoSlide(roomId: string, slot: number, index: number) {
    const { error } = await supabase
        .from("room_lessons")
        .update({ current_index: index })
        .eq("room_id", roomId)
        .eq("slot", slot);
    if (error) throw error;
}
