import { supabase } from "../supabaseClient";
import type { ManifestItem } from "../types/manifest";

async function rpc<T=any>(name: string, params?: Record<string, any>) {
    const { data, error } = await supabase.rpc(name, params ?? {});
    if (error) throw error;
    return data as T;
}

export async function getManifestByRoom(roomCode: string): Promise<ManifestItem[]> {
    const data = await rpc<unknown>("get_room_deck_manifest_public", { p_code: roomCode });
    if (!data || !Array.isArray(data)) return [];
    return data as ManifestItem[];
}

export async function upsertManifest(roomCode: string, deckId: string, manifest: ManifestItem[]): Promise<void> {
    await rpc("upsert_room_deck_manifest", {
        p_code: roomCode,
        p_deck_id: deckId,
        p_manifest: manifest,
    });
}
