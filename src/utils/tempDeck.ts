// src/utils/tempDeck.ts
import { supabase } from "../supabaseClient";

/* ---------------------------- internal helpers ---------------------------- */

function withSlash(prefix: string) {
    return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

async function listAll(bucket: string, prefix: string) {
    const out: { name: string }[] = [];
    let offset = 0;
    const step = 1000;
    // Supabase storage.list supports offset pagination
    for (;;) {
        const { data, error } = await supabase.storage
            .from(bucket)
            .list(withSlash(prefix), { limit: step, offset });
        if (error) throw error;
        const batch = data ?? [];
        out.push(...batch);
        if (batch.length < step) break;
        offset += step;
    }
    return out;
}

async function removeFolderInBucket(bucket: string, prefix: string) {
    const entries = await listAll(bucket, prefix);
    if (!entries.length) return;
    const paths = entries.map((e) => `${withSlash(prefix)}${e.name}`);
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw error;
}

/** copy single object in same bucket (copy→fallback download/upload) */
async function copyObjectInBucket(bucket: string, from: string, to: string, contentType?: string) {
    let copied = false;
    try {
        const { error } = await supabase.storage.from(bucket).copy(from, to);
        if (!error) copied = true;
    } catch { /* noop */ }
    if (!copied) {
        const dl = await supabase.storage.from(bucket).download(from);
        if (dl.error) throw dl.error;
        const up = await supabase.storage.from(bucket).upload(to, dl.data, {
            contentType: contentType ?? undefined,
            upsert: true,
        });
        if (up.error) throw up.error;
    }
}

/** copy all files under prefix in same bucket filtered by ext */
async function copyDirInBucket(bucket: string, fromPrefix: string, toPrefix: string, ext: RegExp) {
    const files = await listAll(bucket, fromPrefix);
    if (!files.length) return;
    // 목적지에 뭔가 있으면 복제 스킵 (중복 방지)
    const dstProbe = await listAll(bucket, toPrefix);
    if (dstProbe.length > 0) return;
    for (const f of files) {
        if (!ext.test(f.name)) continue;
        const from = `${withSlash(fromPrefix)}${f.name}`;
        const to   = `${withSlash(toPrefix)}${f.name}`;
        await copyObjectInBucket(bucket, from, to);
    }
}

async function countFiles(bucket: string, prefix: string, ext: RegExp) {
    const files = await listAll(bucket, prefix);
    return (files ?? []).filter((f) => ext.test(f.name)).length;
}

/** presentations/rooms/.../decks/.../slides-TS.pdf → rooms/.../decks/.../slides-TS/ */
function slidesPrefixFromPdfKey(pdfKey: string): string | null {
    const rel = String(pdfKey).replace(/^presentations\//i, "");
    const m = rel.match(/^(rooms\/[^/]+\/decks\/[^/]+\/slides-\d+)\.pdf$/i);
    return m ? `${m[1]}/` : null;
}

/* ------------------------------- main flows ------------------------------- */

/**
 * 라이브러리의 원본 덱(sourceDeckId)을 '복제 편집'용 임시 덱으로 생성.
 * - PDF는 presentations 버킷에 경로만 복제(보관용)
 * - WebP는 slides 버킷에서 **있으면 그대로 복제**, 없으면 건드리지 않음(재변환 금지)
 * - 기본적으로 교시 배정 ❌ (assignToRoom=true로 바꾸면 배정)
 */
export async function ensureEditingDeckFromSource({
                                                      roomCode,
                                                      sourceDeckId,
                                                      slot = 1,
                                                      assignToRoom = false,
                                                  }: {
    roomCode: string;
    sourceDeckId: string;
    slot?: number;
    assignToRoom?: boolean;
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

    // 새 덱 생성 (is_temp 같은 스키마 의존 ❌)
    const ins = await supabase
        .from("decks")
        .insert({ title: (src.title ? `${src.title} (편집)` : "Untitled (edit)") })
        .select("id")
        .single();
    if (ins.error) throw ins.error;
    const newDeckId = ins.data.id as string;

    // (옵션) room 배정 — 기본값 false
    if (assignToRoom) {
        await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot });
    }

    // PDF 복사 (presentations)
    const ts = Date.now();
    const destPdfKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;
    await copyObjectInBucket(
        "presentations",
        String(src.file_key).replace(/^presentations\//i, ""),
        destPdfKey,
        "application/pdf",
    );

    // WebP 복제 (slides) — 있으면 그대로 복제, 없으면 건드리지 않음
    const srcSlides = slidesPrefixFromPdfKey(String(src.file_key));
    const dstSlides = slidesPrefixFromPdfKey(destPdfKey);
    if (srcSlides && dstSlides) {
        const hasWebp = await countFiles("slides", srcSlides, /\.webp$/i);
        if (hasWebp > 0) {
            await copyDirInBucket("slides", srcSlides, dstSlides, /\.webp$/i);
        }
    }

    // 페이지 수 계산 (우선순위: 새 경로 → 원본 경로)
    const pages =
        (dstSlides ? await countFiles("slides", dstSlides, /\.webp$/i) : 0) ||
        (srcSlides ? await countFiles("slides", srcSlides, /\.webp$/i) : 0) ||
        0;

    // 덱 갱신
    await supabase
        .from("decks")
        .update({ file_key: destPdfKey, file_pages: pages || null })
        .eq("id", newDeckId);

    // PDF URL (public + signed 둘 다 리턴해둠)
    const { data: pub } = supabase.storage
        .from("presentations")
        .getPublicUrl(destPdfKey);
    const signed = await supabase.storage
        .from("presentations")
        .createSignedUrl(destPdfKey, 1800);

    return {
        roomId,
        deckId: newDeckId,
        fileKey: destPdfKey,
        filePages: pages,
        pdfPublicUrl: pub?.publicUrl ?? null,
        pdfSignedUrl: signed.data?.signedUrl ?? null,
    };
}

/** 저장 후 임시 덱 정리 (스토리지/연결 모두 제거). DB 스키마 컬럼 의존 ❌ */
export async function finalizeTempDeck({
                                           roomId,
                                           deckId,
                                           deleteDeckRow = true,
                                       }: {
    roomId: string;
    deckId: string;
    deleteDeckRow?: boolean;
}) {
    // 교시 연결 해제
    await supabase.from("room_decks").delete().match({ room_id: roomId, deck_id: deckId });

    const basePrefix = `rooms/${roomId}/decks/${deckId}/`;

    // 스토리지 정리: presentations + slides
    await removeFolderInBucket("presentations", basePrefix);
    await removeFolderInBucket("slides", basePrefix);

    if (deleteDeckRow) {
        await supabase.from("decks").delete().eq("id", deckId);
    } else {
        await supabase.from("decks").update({
            file_key: null,
            file_pages: null,
        }).eq("id", deckId);
    }
}
