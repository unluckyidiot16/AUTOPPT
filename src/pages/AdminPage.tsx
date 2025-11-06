// src/pages/AdminDataHealth.tsx
import React from "react";
import { supabase } from "../supabaseClient";
import { getPdfUrlFromKey } from "../utils/supaFiles";
import { useNavigate } from "react-router-dom";

/** 간단 도우미 */
function fmtDate(s?: string | null) {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleString();
}

type Room = { id: string; code: string; title?: string | null; created_at?: string };
type Deck = {
    id: string; title?: string | null; is_temp?: boolean | null; file_key?: string | null;
    file_pages?: number | null; created_at?: string | null; archived_at?: string | null;
};
type RoomDeck = { room_id: string; deck_id: string; slot: number };

export default function AdminDataHealth() {
    const nav = useNavigate();
    const [rooms, setRooms] = React.useState<Room[]>([]);
    const [decks, setDecks] = React.useState<Deck[]>([]);
    const [links, setLinks] = React.useState<RoomDeck[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [msg, setMsg] = React.useState<string>("");
    const [filter, setFilter] = React.useState("");
    const [editRoomCode, setEditRoomCode] = React.useState(""); // 에디터 테스트용 room 코드


    // 계산 필드
    const roomMap = React.useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);
    const deckMap = React.useMemo(() => new Map(decks.map(d => [d.id, d])), [decks]);

    const orphanLinks = React.useMemo(() => {
        return links.filter(l => !roomMap.has(l.room_id) || !deckMap.has(l.deck_id));
    }, [links, roomMap, deckMap]);

    const dirtyDecks = React.useMemo(() => {
        const now = Date.now();
        const ONE_WEEK = 7 * 24 * 3600 * 1000;
        return decks.filter(d => {
            const isOldTemp =
                d.is_temp && d.created_at && now - new Date(d.created_at).getTime() > ONE_WEEK;
            return !d.file_key || isOldTemp || !!d.archived_at;
        });
    }, [decks]);

    async function refresh() {
        setLoading(true);
        setMsg("");
        try {
            const [{ data: r, error: er }, { data: d, error: ed }, { data: rd, error: erd }] =
                await Promise.all([
                    supabase.from("rooms_public").select("code,is_open").order("code"),
                    supabase.from("decks").select("id,title,is_temp,file_key,file_pages,created_at,archived_at").order("created_at", { ascending: false }).limit(500),
                    supabase.from("room_decks").select("room_id,deck_id,slot").limit(2000),
                ]);
            if (er) throw er;
            if (ed) throw ed;
            if (erd) throw erd;
            setRooms(r || []);
            setDecks(d || []);
            setLinks(rd || []);
        } catch (e: any) {
            setMsg(e?.message || "로드 실패");
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => { refresh(); }, []);

    /** ----- 액션들 ----- */

    async function deleteOrphanLink(l: RoomDeck) {
        if (!confirm(`room_decks 링크를 삭제할까요?\nroom=${l.room_id}\ndeck=${l.deck_id}\nslot=${l.slot}`)) return;
        const { error } = await supabase.from("room_decks")
            .delete()
            .match({ room_id: l.room_id, deck_id: l.deck_id, slot: l.slot });
        if (error) { alert(error.message); return; }
        await refresh();
    }

    async function clearRoomSlot(roomId: string, slot: number) {
        if (!confirm(`이 방의 ${slot}교시 링크를 비울까요?`)) return;
        const { error } = await supabase.from("room_decks").delete().match({ room_id: roomId, slot });
        if (error) { alert(error.message); return; }
        await refresh();
    }

    async function deleteRoom(roomId: string) {
        if (!confirm("방을 삭제할까요? (room_decks는 CASCADE로 함께 삭제됩니다)")) return;
        const { error } = await supabase.from("rooms").delete().eq("id", roomId);
        if (error) { alert(error.message); return; }
        await refresh();
    }

    async function archiveDeck(deckId: string) {
        if (!confirm("덱을 아카이브 처리할까요? (DB에 남고 숨김 상태)")) return;
        // RPC 없을 수 있으니 직접 업데이트
        const { error } = await supabase.from("decks")
            .update({ archived_at: new Date().toISOString() })
            .eq("id", deckId);
        if (error) { alert(error.message); return; }
        await refresh();
    }

    async function purgeDeck(deck: Deck) {
        if (!confirm("덱을 영구 삭제할까요? (room_decks 링크가 있으면 먼저 지워야 할 수 있어요)")) return;
        // 스토리지 파일 제거 시도 → DB 삭제
        try {
            if (deck.file_key) {
                const rm = await supabase.storage.from("presentations").remove([deck.file_key]);
                if (rm.error) console.warn("storage.remove error:", rm.error.message);
            }
        } catch {}
        // room_decks 링크 제거(혹시 FK가 없을 때 대비)
        await supabase.from("room_decks").delete().eq("deck_id", deck.id);
        const { error } = await supabase.from("decks").delete().eq("id", deck.id);
        if (error) { alert(error.message); return; }
        await refresh();
    }

    async function openSigned(fileKey?: string | null) {
        if (!fileKey) return;
        try {
            const url = await getPdfUrlFromKey(fileKey, { ttlSec: 1800 });
            window.open(url, "_blank");
        } catch (e: any) {
            alert(e?.message || "서명 URL 생성 실패");
        }
    }

    function openEditByDeck(deckId: string) {
        if (!editRoomCode) { alert("상단에 room 코드(예: CLASS-XXXXXX)를 입력해 주세요."); return; }
        nav(`/editor?room=${encodeURIComponent(editRoomCode)}&src=${encodeURIComponent(deckId)}`);
    }
    function openEditByKey(fileKey: string) {
        if (!editRoomCode) { alert("상단에 room 코드를 입력해 주세요."); return; }
        nav(`/editor?room=${encodeURIComponent(editRoomCode)}&srcKey=${encodeURIComponent(fileKey)}`);
    }

    const filteredRooms = React.useMemo(() => {
        const k = filter.trim().toLowerCase();
        if (!k) return rooms;
        return rooms.filter(r =>
            r.code.toLowerCase().includes(k) ||
            (r.name || "").toLowerCase().includes(k) ||
            (r.id || "").includes(k)
        );
    }, [rooms, filter]);

    const filteredDecks = React.useMemo(() => {
        const k = filter.trim().toLowerCase();
        if (!k) return decks;
        return decks.filter(d =>
            (d.title || "").toLowerCase().includes(k) ||
            (d.file_key || "").toLowerCase().includes(k) ||
            (d.id || "").includes(k)
        );
    }, [decks, filter]);

    // room별 slot 목록 캐시
    const roomSlotsMap = React.useMemo(() => {
        const m = new Map<string, RoomDeck[]>();
        links.forEach(l => {
            if (!m.has(l.room_id)) m.set(l.room_id, []);
            m.get(l.room_id)!.push(l);
        });
        return m;
    }, [links]);

    return (
        <div className="p-4 max-w-[1200px] mx-auto">
            <h1 className="text-xl font-semibold mb-2">Admin · Data Health</h1>

            <div className="flex flex-wrap gap-2 items-center mb-3">
                <input
                    className="px-3 py-2 border rounded w-[280px]"
                    placeholder="검색(방 코드/이름, 덱 제목/파일키)…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <input
                    className="px-3 py-2 border rounded w-[220px]"
                    placeholder="에디터용 room 코드"
                    value={editRoomCode}
                    onChange={(e) => setEditRoomCode(e.target.value.trim())}
                />
                <button className="px-3 py-2 border rounded" onClick={refresh} disabled={loading}>새로고침</button>
                <span className="opacity-60 text-sm">{rooms.length} rooms · {decks.length} decks · {links.length} links</span>
                {msg && <span className="text-red-600 ml-2">{msg}</span>}
            </div>

            {/* Rooms */}
            <section className="mb-6">
                <h2 className="font-semibold mb-2">Rooms</h2>
                <div style={{ display: "grid", gap: 12 }}>
                    {filteredRooms.map((r) => {
                        const slots = roomSlotsMap.get(r.id) || [];
                        return (
                            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="font-medium">{r.title || "(no title)"} <span className="opacity-60">· {r.code}</span></div>
                                    <div className="ml-auto text-xs opacity-70">{fmtDate(r.created_at)}</div>
                                </div>
                                <div className="text-xs opacity-70 mb-2"><code>{r.id}</code></div>
                                {/* 슬롯 표 */}
                                <div className="flex flex-wrap gap-6">
                                    {[1,2,3,4,5,6].map(n => {
                                        const link = slots.find(s => s.slot === n);
                                        const dk = link ? deckMap.get(link.deck_id) : undefined;
                                        return (
                                            <div key={n} style={{ minWidth: 220 }}>
                                                <div className="text-sm font-medium mb-1">{n}교시</div>
                                                {link && dk ? (
                                                    <div className="text-xs">
                                                        <div className="truncate mb-1">{dk.title || dk.id}</div>
                                                        <div className="truncate mb-1 opacity-70">{dk.file_key || "(no file)"}</div>
                                                        <div className="flex gap-2">
                                                            {dk.file_key && (
                                                                <button className="px-2 py-1 border rounded text-xs"
                                                                        onClick={() => openSigned(dk.file_key!)}>링크</button>
                                                            )}
                                                            <button className="px-2 py-1 border rounded text-xs"
                                                                    onClick={() => dk.file_key ? openEditByKey(dk.file_key) : openEditByDeck(dk.id)}>편집</button>
                                                            <button className="px-2 py-1 border rounded text-xs"
                                                                    onClick={() => clearRoomSlot(r.id, n)}>비우기</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-xs opacity-60">비어 있음</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-3">
                                    <button className="px-3 py-1.5 border rounded" onClick={() => deleteRoom(r.id)}>방 삭제</button>
                                </div>
                            </div>
                        );
                    })}
                    {filteredRooms.length === 0 && <div className="opacity-60">표시할 방이 없습니다.</div>}
                </div>
            </section>

            {/* Decks */}
            <section className="mb-6">
                <h2 className="font-semibold mb-2">Decks</h2>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                    {filteredDecks.map((d) => (
                        <div key={d.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                            <div className="text-sm font-medium truncate mb-1">{d.title || "(untitled)"}</div>
                            <div className="text-xs opacity-70 mb-1"><code>{d.id}</code></div>
                            <div className="text-xs opacity-70 mb-1">{d.is_temp ? "is_temp · " : ""}{d.archived_at ? "archived · " : ""}{fmtDate(d.created_at)}</div>
                            <div className="text-xs break-all mb-2">{d.file_key || "(file_key 없음)"}</div>
                            <div className="flex flex-wrap gap-2">
                                {d.file_key && <button className="px-2 py-1 border rounded text-xs" onClick={() => openSigned(d.file_key!)}>링크</button>}
                                {d.file_key
                                    ? <button className="px-2 py-1 border rounded text-xs" onClick={() => openEditByKey(d.file_key!)}>편집</button>
                                    : <button className="px-2 py-1 border rounded text-xs" onClick={() => openEditByDeck(d.id)}>편집</button>}
                                {!d.archived_at && <button className="px-2 py-1 border rounded text-xs" onClick={() => archiveDeck(d.id)}>아카이브</button>}
                                <button className="px-2 py-1 border rounded text-xs" onClick={() => purgeDeck(d)}>영구삭제</button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Orphan Links */}
            <section className="mb-10">
                <h2 className="font-semibold mb-2">고아 room_decks 링크</h2>
                {orphanLinks.length === 0 ? (
                    <div className="opacity-60">정상</div>
                ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                        {orphanLinks.map((l, i) => (
                            <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                                <div className="text-xs"><b>room</b> <code>{l.room_id}</code></div>
                                <div className="text-xs"><b>deck</b> <code>{l.deck_id}</code></div>
                                <div className="text-xs mb-2"><b>slot</b> {l.slot}</div>
                                <button className="px-2 py-1 border rounded text-xs" onClick={() => deleteOrphanLink(l)}>링크 삭제</button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Dirty decks quick view */}
            <section>
                <h2 className="font-semibold mb-2">더티 덱(파일키 없음 / 오래된 임시 / 아카이브)</h2>
                {dirtyDecks.length === 0 ? <div className="opacity-60">정상</div> : (
                    <ul className="space-y-2">
                        {dirtyDecks.map(d => (
                            <li key={d.id} className="border rounded p-2 text-sm">
                                <div className="font-medium">{d.title || d.id}</div>
                                <div className="text-xs opacity-70">is_temp:{String(!!d.is_temp)} · archived:{String(!!d.archived_at)} · {fmtDate(d.created_at)}</div>
                                <div className="text-xs break-all mb-2">{d.file_key || "(no file_key)"}</div>
                                <div className="flex gap-2">
                                    {d.file_key && <button className="px-2 py-1 border rounded text-xs" onClick={() => openSigned(d.file_key!)}>링크</button>}
                                    <button className="px-2 py-1 border rounded text-xs" onClick={() => archiveDeck(d.id)}>아카이브</button>
                                    <button className="px-2 py-1 border rounded text-xs" onClick={() => purgeDeck(d)}>영구삭제</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
