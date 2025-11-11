// src/pages/DeckEditorPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import DeckEditor from "../components/DeckEditor";
import EditorPreviewPane from "../components/EditorPreviewPane";
import EditorThumbnailStrip from "../components/EditorThumbnailStrip";
import { slidesPrefixOfAny } from "../utils/supaFiles";
import { upsertManifest } from "../api/overrides";

function useQS() { return new URLSearchParams(useLocation().search); }
function isImage(name: string) { return /\.webp$/i.test(name); }
async function countSlides(prefix: string) {
    const { data, error } = await supabase.storage.from("slides").list(prefix, { limit: 1000 });
    if (error) return 0;
    return (data ?? []).filter(f => isImage(f.name)).length;
}

export default function DeckEditorPage() {
    const nav = useNavigate();
    const qs = useQS();

    const roomCode = qs.get("room") || "";     // 선택 사항
    const srcDeckId = qs.get("src") || "";     // DB 덱 ID (선택)
    const srcKey    = qs.get("srcKey") || "";  // presentations/* or slides/* (선택)

    const [deckId, setDeckId] = React.useState<string | null>(srcDeckId || null);
    const [slidesPrefix, setSlidesPrefix] = React.useState<string | null>(null); // e.g. rooms/<rid>/decks/<did>
    const [totalPages, setTotalPages] = React.useState<number>(0);
    const [page, setPage] = React.useState<number>(1);
    const [saving, setSaving] = React.useState(false);

    // 초기 로드: slides-only
    React.useEffect(() => {
        let off = false;
        (async () => {
            try {
                let prefix: string | null = null;
                let did: string | null = deckId;

                if (srcDeckId) {
                    // DB에서 file_key 읽고 → slides prefix로 정규화
                    const row = await supabase.from("decks").select("id,file_key").eq("id", srcDeckId).maybeSingle();
                    did = row.data?.id ?? null;
                    prefix = slidesPrefixOfAny(row.data?.file_key || "");
                } else if (srcKey) {
                    // URL로 들어온 presentations/slides 키에서 곧장 slides prefix 계산
                    prefix = slidesPrefixOfAny(srcKey);
                    // deckId 없이 에디터는 동작 가능(저장 시 roomCode 없으면 storage 폴백만)
                    did = did ?? null;
                }

                if (!prefix) {
                    alert("슬라이드 경로를 찾을 수 없어요. (slides prefix 미해석)");
                    return;
                }

                const pages = await countSlides(prefix);
                if (off) return;
                setDeckId(did);
                setSlidesPrefix(prefix);
                setTotalPages(Math.max(1, pages));
                setPage(1);
            } catch (e: any) {
                console.error(e);
                if (!off) alert(e?.message || String(e));
            }
        })();
        return () => { off = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [srcDeckId, srcKey]);

    // 저장
    const handleSave = React.useCallback(async (items: any[]) => {
        if (!deckId) {
            // deckId가 없어도 room이 있으면 RPC, 없으면 storage 폴백
            if (!slidesPrefix) { alert("slides prefix가 없습니다."); return; }
        }
        setSaving(true);
        try {
            const ok = await upsertManifest(roomCode, deckId || "", items);
            if (!ok.ok) throw new Error(ok.reason || "저장 실패");
            alert(`저장 완료 (${ok.via})`);
        } catch (e: any) {
            alert(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    }, [deckId, roomCode, slidesPrefix]);

    if (!slidesPrefix) {
        return (
            <div className="p-6 text-slate-500">
                슬라이드를 불러오는 중… (src 또는 srcKey 쿼리 파라미터 필요)
            </div>
        );
    }

    return (
        <div className="h-full grid grid-rows-[auto_1fr]">
            {/* 상단 바 */}
            <div className="p-2 border-b border-slate-200 flex items-center gap-2">
                <button className="px-3 py-1 rounded border" onClick={() => nav(`/teacher?room=${encodeURIComponent(roomCode)}`)}>← 돌아가기</button>
                <div className="text-sm opacity-70">
                    room: <code>{roomCode || "(없음)"}</code> · deck: <code>{deckId || "(없음)"}</code> · pages: {totalPages}
                </div>
                <div className="ml-auto">
                    <button disabled={saving} className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-50"
                            onClick={() => (window as any).__editorDoSave?.()}>
                        {saving ? "저장 중…" : "저장"}
                    </button>
                </div>
            </div>

            {/* 본문: 좌 썸네일 / 중앙 미리보기 / 우 편집 */}
            <div className="grid grid-cols-[240px_1fr_360px] h-[calc(100vh-42px)]">
                <div className="border-r border-slate-200 overflow-auto">
                    <EditorThumbnailStrip
                        fileKey={slidesPrefix}              // slides prefix 사용
                        totalPages={totalPages}
                        page={page}
                        onSelect={setPage}
                    />
                </div>
                <div className="bg-slate-50">
                    <EditorPreviewPane fileKey={slidesPrefix} page={page} />
                </div>
                <div className="border-l border-slate-200 overflow-auto">
                    <DeckEditor
                        deckId={deckId || undefined}
                        roomCode={roomCode || undefined}
                        totalPages={totalPages}
                        onSave={handleSave}
                        bindDoSaveRef={(fn) => ((window as any).__editorDoSave = fn)}
                    />
                </div>
            </div>
        </div>
    );
}
