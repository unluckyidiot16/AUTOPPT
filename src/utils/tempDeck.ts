// src/utils/tempDeck.ts
import { supabase } from "../supabaseClient";
import { getPdfUrlFromKey } from "./supaFiles";

/** presentations 버킷에서 prefix 경로 밑 전체 삭제 */
async function removeFolder(prefix: string) {
    let page = 0;
    for (;;) {
        const { data, error } = await supabase.storage
            .from("presentations")
            .list(prefix, { limit: 1000, offset: page * 1000 });
        if (error) throw error;
        if (!data?.length) break;
        const paths = data.map((d) => `${prefix}/${d.name}`);
        const rm = await supabase.storage.from("presentations").remove(paths);
        if (rm.error) throw rm.error;
        if (data.length < 1000) break;
        page++;
    }
}

/** object copy (copy 미지원 환경 대비 download→upload 폴백) */
async function copyObjectInBucket(bucket: string, from: string, to: string) {
    let copied = false;
    try {
        const { error } = await supabase.storage.from(bucket).copy(from, to);
        if (!error) copied = true;
    } catch {}
    if (!copied) {
        const dl = await supabase.storage.from(bucket).download(from);
        if (dl.error) throw dl.error;
        const up = await supabase.storage.from(bucket).upload(to, dl.data, {
            contentType: "application/pdf",
            upsert: true,
        });
        if (up.error) throw up.error;
    }
}

/**
 * 라이브러리에서 고른 원본 덱(sourceDeckId)을 '복제 편집'용 임시 덱으로 만들어
 * 현재 room에 배정하고, 복사한 PDF의 서명 URL을 반환한다.
 */
export async function ensureEditingDeckFromSource({
                                                      roomCode,
                                                      sourceDeckId,
                                                      slot = 1,
                                                  }: {
    roomCode: string;
    sourceDeckId: string;
    slot?: number;
}) {
    // room
    const { data: room, error: eRoom } = await supabase
        .from("rooms")
        .select("id")
        .eq("code", roomCode)
        .maybeSingle();
    if (eRoom || !room?.id) throw eRoom ?? new Error("room not found");
    const roomId = room.id as string;

    // source deck
    const { data: src, error: eSrc } = await supabase
        .from("decks")
        .select("id,title,file_key,file_pages")
        .eq("id", sourceDeckId)
        .maybeSingle();
    if (eSrc) throw eSrc;
    if (!src?.file_key) throw new Error("원본 덱에 파일이 없습니다.");

    // temp deck 생성
    const ins = await supabase
        .from("decks")
        .insert({ title: (src.title ? `${src.title} (편집)` : "Untitled (temp)"), is_temp: true })
        .select("id")
        .single();
    if (ins.error) throw ins.error;
    const newDeckId = ins.data.id as string;

    // room 배정
    await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot });

    // 파일 복사
    const ts = Date.now();
    const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;
    await copyObjectInBucket("presentations", src.file_key as string, destKey);

    // 덱 갱신
    await supabase
        .from("decks")
        .update({ file_key: destKey, file_pages: src.file_pages ?? null })
        .eq("id", newDeckId);

    // 서명 URL
    const signedUrl = await getPdfUrlFromKey(destKey, { ttlSec: 1800 });
    return { roomId, deckId: newDeckId, fileKey: destKey, filePages: Number(src.file_pages || 0), signedUrl };
}

/** (옵션) 저장 후 임시 덱 정리 */
export async function finalizeTempDeck({ roomId, deckId, deleteDeckRow = true }: { roomId: string; deckId: string; deleteDeckRow?: boolean }) {
    await supabase.from("room_decks").delete().eq("room_id", roomId).eq("deck_id", deckId);
    await removeFolder(`rooms/${roomId}/decks/${deckId}`);
    if (deleteDeckRow) await supabase.from("decks").delete().eq("id", deckId);
    else await supabase.from("decks").update({ file_key: null, file_pages: null, is_temp: true }).eq("id", deckId);
}
