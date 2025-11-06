// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import { getPdfUrlFromKey } from "../utils/supaFiles";

type DeckRow = {
    id: string;                         // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null;
    file_pages: number | null;
    origin: "db" | "storage";
};

function useSignedUrl(key: string | null | undefined, ttlSec = 1800) {
    const [url, setUrl] = React.useState<string>("");
    React.useEffect(() => {
        let alive = true;
        (async () => {
            if (!key) { setUrl(""); return; }
            try {
                const u = await getPdfUrlFromKey(key, { ttlSec });
                if (alive) setUrl(u);
            } catch { if (alive) setUrl(""); }
        })();
        return () => { alive = false; };
    }, [key, ttlSec]);
    return url;
}

function Thumb({ keyStr }: { keyStr: string }) {
    const fileUrl = useSignedUrl(keyStr);
    return (
        <div
            style={{
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid rgba(148,163,184,0.25)",
                height: 110,                    // 🔽 더 작게
                display: "grid",
                placeItems: "center",
                background: "#fff",
            }}
        >
            {fileUrl ? <PdfViewer fileUrl={fileUrl} page={1} maxHeight="110px" /> : <div style={{ height: 110 }} />}
        </div>
    );
}

export default function PdfLibraryPage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const qs = React.useMemo(() => new URLSearchParams(search), [search]);
    const roomCode = qs.get("room") || "";

    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [decks, setDecks] = React.useState<DeckRow[]>([]);
    const [keyword, setKeyword] = React.useState("");
    const [slotSel, setSlotSel] = React.useState<Record<string, number>>({}); // 카드별 교시 선택

    const filtered = React.useMemo(() => {
        if (!keyword.trim()) return decks;
        const k = keyword.trim().toLowerCase();
        return decks.filter((d) =>
            (d.title || "").toLowerCase().includes(k) || (d.file_key || "").toLowerCase().includes(k)
        );
    }, [decks, keyword]);

    // ---------- Storage 인덱스 스캔 ----------
    async function fetchFromStorage(limitFolders = 120): Promise<DeckRow[]> {
        type SFile = { name: string };
        const bucket = supabase.storage.from("presentations");
        const top = await bucket.list("decks", { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
        if (top.error) throw top.error;
        const folders = (top.data || []).slice(0, limitFolders).map(f => f.name).filter(Boolean);

        const rows: DeckRow[] = [];
        for (const folder of folders) {
            const path = `decks/${folder}`;
            const ls = await bucket.list(path, { limit: 50, sortBy: { column: "updated_at", order: "desc" } });
            if (ls.error) continue;
            const files = (ls.data as SFile[]) || [];
            const pick =
                files.find(f => /slides-.*\.pdf$/i.test(f.name)) ||
                files.find(f => /\.pdf$/i.test(f.name));
            if (!pick) continue;

            const file_key = `${path}/${pick.name}`;
            rows.push({ id: `s:${file_key}`, title: folder, file_key, file_pages: null, origin: "storage" });
            if (rows.length >= 200) break;
        }
        return rows;
    }

    // ---------- 목록 로드: RPC 우선 + 스토리지 병합 ----------
    React.useEffect(() => {
        let cancel = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                let merged: DeckRow[] = [];

                try {
                    const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                    if (error) throw error;
                    merged = (data || []).map((d: any) => ({
                        id: d.id, title: d.title ?? null, file_key: d.file_key ?? null, file_pages: d.file_pages ?? null, origin: "db" as const
                    }));
                } catch (e) {
                    const { data, error } = await supabase
                        .from("decks")
                        .select("id,title,file_key,file_pages")
                        .not("file_key", "is", null)
                        .limit(200);
                    if (!error) {
                        merged = (data || []).map((d: any) => ({
                            id: d.id, title: d.title ?? null, file_key: d.file_key ?? null, file_pages: d.file_pages ?? null, origin: "db" as const
                        }));
                    }
                }

                try {
                    const sRows = await fetchFromStorage(120);
                    const byKey = new Map<string, DeckRow>();
                    for (const r of merged) if (r.file_key) byKey.set(r.file_key, r);
                    for (const r of sRows) if (r.file_key && !byKey.has(r.file_key)) byKey.set(r.file_key, r);
                    merged = Array.from(byKey.values());
                } catch {}

                if (!cancel) setDecks(merged);
                if (!cancel && merged.length === 0) setError("표시할 자료가 없습니다. (DB/RPC 또는 스토리지에 자료 없음)");
            } catch (e: any) {
                if (!cancel) setError(e?.message || "목록을 불러오지 못했어요.");
            } finally {
                if (!cancel) setLoading(false);
            }
        })();
        return () => { cancel = true; };
    }, []);

    // ---------- 유틸: 방 id 및 복제/배정 ----------
    async function getRoomIdByCode(code: string): Promise<string> {
        const { data, error } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
        if (error || !data?.id) throw error ?? new Error("room not found");
        return data.id as string;
    }

    async function createDeckFromFileKeyAndAssign(fileKey: string, roomId: string, slot: number) {
        const ins = await supabase.from("decks").insert({ title: "Imported", is_temp: true }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

        const ts = Date.now();
        const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;

        // copy → download/upload 폴백
        let copied = false;
        try { const { error } = await supabase.storage.from("presentations").copy(fileKey, destKey); if (!error) copied = true; } catch {}
        if (!copied) {
            const dl = await supabase.storage.from("presentations").download(fileKey);
            if (dl.error) throw dl.error;
            const up = await supabase.storage.from("presentations").upload(destKey, dl.data, { contentType: "application/pdf", upsert: true });
            if (up.error) throw up.error;
        }

        await supabase.from("decks").update({ file_key: destKey }).eq("id", newDeckId);
        await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot });
        return newDeckId;
    }

    async function assignDeckToSlot(d: DeckRow, slot: number) {
        if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
        try {
            const roomId = await getRoomIdByCode(roomCode);
            if (d.origin === "db") {
                // DB 덱은 RPC로 바로 배정
                const { error } = await supabase.rpc("assign_room_deck_by_ext", {
                    p_code: roomCode, p_deck_id: d.id, p_slot: slot
                });
                if (error) throw error;
            } else {
                // 스토리지만 있는 항목은 복제 후 배정
                if (!d.file_key) throw new Error("파일이 없습니다.");
                await createDeckFromFileKeyAndAssign(d.file_key, roomId, slot);
            }
            alert(`✅ ${slot}교시로 불러왔습니다.`);
        } catch (e: any) {
            console.error(e);
            alert(`불러오기 실패: ${e?.message || e}`);
        }
    }

    const openEdit = (d: DeckRow) => {
        if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
        if (!d.file_key) { alert("파일이 없습니다."); return; }
        if (d.origin === "db") nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
        else nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(d.file_key)}`);
    };

    return (
        <div className="px-4 py-4 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-3">
                <h1 className="text-xl font-semibold">자료함</h1>
                <div className="text-sm opacity-70">room: <code>{roomCode || "(미지정)"}</code></div>
            </div>

            <div className="flex items-center gap-2 mb-4">
                <input
                    className="px-3 py-2 rounded-md border border-slate-300 w-full"
                    placeholder="제목/경로 검색…"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                />
                <button className="px-3 py-2 rounded-md border border-slate-300 bg-white" onClick={() => setKeyword("")}>초기화</button>
            </div>

            {loading && <div className="opacity-70">불러오는 중…</div>}
            {error && <div className="text-red-500">{error}</div>}

            {/* 🔳 Grid 레이아웃 (카드 폭 최소 220px) */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {filtered.map((d) => {
                    const slot = slotSel[d.id] ?? 1;
                    return (
                        <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col">
                            <div className="text-sm font-medium line-clamp-2">{d.title || "Untitled"}</div>
                            <div className="text-[11px] opacity-60 mb-2">{d.origin === "db" ? "DB" : "Storage"}</div>
                            {d.file_key ? <Thumb keyStr={d.file_key} /> : <div className="h-[110px] bg-slate-100 rounded-md" />}

                            <div className="mt-3 flex items-center gap-2">
                                <a className="px-2 py-1 rounded-md border text-sm" href={d.file_key ? (awaitableLink(d.file_key)) : "#"} target="_blank" rel="noreferrer"
                                   onClick={(e) => { if (!d.file_key) e.preventDefault(); }}>
                                    링크 열기
                                </a>
                                <button className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm ml-auto" onClick={() => openEdit(d)}>편집</button>
                            </div>

                            {/* 불러오기(교시 지정) */}
                            <div className="mt-2 flex items-center gap-2">
                                <select
                                    className="px-2 py-1 border rounded-md text-sm"
                                    value={slot}
                                    onChange={(e) => setSlotSel((s) => ({ ...s, [d.id]: Number(e.target.value) }))}
                                >
                                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}교시</option>)}
                                </select>
                                <button
                                    className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                                    onClick={() => assignDeckToSlot(d, slot)}
                                >
                                    지금 불러오기
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** 앵커에서 쓰기 편하게: fileKey → 서명 URL 프라미스 없이 링크 흉내 */
function awaitableLink(fileKey: string) {
    // 실사용 시엔 바로 클릭되므로 의미는 적지만, 새 탭에서 열어도 문제 없게 캐시버스터 없는 public 폴백 포함
    // (PdfViewer는 getPdfUrlFromKey를 쓰고, 여기서는 사용자 클릭 편의상 서명 URL 실패해도 열리게 처리)
    const u = supabase.storage.from("presentations").getPublicUrl(fileKey).data.publicUrl;
    return u;
}
