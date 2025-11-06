// src/pages/AdminDataHealth.tsx
import React from "react";
import { supabase } from "../supabaseClient";

export default function AdminDataHealth() {
    const [orphans, setOrphans] = React.useState<any[]>([]);
    const [dirty, setDirty] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [msg, setMsg] = React.useState<string>("");

    async function refresh() {
        setLoading(true); setMsg("");
        try {
            const [o, d] = await Promise.all([
                supabase.rpc("list_orphan_room_decks"),
                supabase.rpc("list_dirty_decks", { p_days: 7 })
            ]);
            if (o.error) throw o.error;
            if (d.error) throw d.error;
            setOrphans(o.data || []);
            setDirty(d.data || []);
        } catch (e:any) {
            setMsg(e.message || "로드 실패");
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => { refresh(); }, []);

    async function fixOrphan(idRow: any) {
        // 고아 room_decks 행 삭제
        const { error } = await supabase.from("room_decks")
            .delete()
            .match({ room_id: idRow.room_id, deck_id: idRow.deck_id, slot: idRow.slot });
        if (!error) refresh();
    }

    async function archiveDeck(id: string) {
        const { error } = await supabase.rpc("archive_deck", { p_deck_id: id });
        if (!error) refresh();
    }

    async function purgeArchived() {
        const { error } = await supabase.rpc("purge_archived_decks", { p_days: 30 });
        if (!error) refresh();
    }

    return (
        <div className="p-4 max-w-6xl mx-auto">
            <h1 className="text-xl font-semibold mb-3">Data Health</h1>
            <div className="mb-3 flex gap-2">
                <button className="px-3 py-2 border rounded" onClick={refresh} disabled={loading}>새로고침</button>
                <button className="px-3 py-2 border rounded" onClick={purgeArchived}>아카이브 30일↑ 영구삭제</button>
            </div>
            {msg && <div className="text-red-500 mb-2">{msg}</div>}

            <section className="mb-6">
                <h2 className="font-semibold mb-2">고아 room_decks</h2>
                {orphans.length === 0 ? <div className="opacity-60">정상</div> : (
                    <ul className="space-y-2">
                        {orphans.map((r:any, i:number) => (
                            <li key={i} className="border rounded p-2 flex items-center gap-2">
                                <code className="text-xs">{r.room_id}</code>
                                <span>slot {r.slot}</span>
                                <code className="text-xs">{r.deck_id}</code>
                                <button className="ml-auto px-2 py-1 border rounded" onClick={() => fixOrphan(r)}>삭제</button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h2 className="font-semibold mb-2">더티 덱 (file_key 없음 / 오래된 임시 / 아카이브)</h2>
                {dirty.length === 0 ? <div className="opacity-60">정상</div> : (
                    <ul className="space-y-2">
                        {dirty.map((d:any) => (
                            <li key={d.id} className="border rounded p-2">
                                <div className="text-sm font-medium">{d.title || d.id}</div>
                                <div className="text-xs opacity-70">{d.is_temp ? "is_temp" : ""} {d.archived_at ? "archived" : ""}</div>
                                <div className="text-xs break-all">{d.file_key || "(file_key 없음)"}</div>
                                <div className="mt-2 flex gap-2">
                                    <button className="px-2 py-1 border rounded" onClick={() => archiveDeck(d.id)}>아카이브</button>
                                    {/* 필요 시: 파일 존재 체크 버튼/복구 버튼 추가 */}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
