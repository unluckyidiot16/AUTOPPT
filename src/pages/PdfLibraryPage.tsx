// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import { getPdfUrlFromKey } from "../utils/supaFiles";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";

// ---- Types ----
type DeckRow = {
    id: string;                   // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null;      // presentations/* 경로
    file_pages: number | null;
    origin: "db" | "storage";     // DB(decks 테이블) vs storage-only(폴더 스캔)
};

// ---- Small utils ----
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

function Thumb({ keyStr, badge }: { keyStr: string; badge: React.ReactNode }) {
    const fileUrl = useSignedUrl(keyStr);
    return (
        <div
            style={{
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(148,163,184,0.35)",
                height: 120,
                display: "grid",
                placeItems: "center",
                background: "#fff",
            }}
        >
            {fileUrl ? <PdfViewer fileUrl={fileUrl} page={1} maxHeight="120px" /> : <div style={{ height: 120 }} />}
            <div style={{ position: "absolute", top: 6, left: 6 }}>{badge}</div>
        </div>
    );
}

function Chip({ color, children }: { color: "blue" | "green" | "slate" | "red"; children: React.ReactNode }) {
    const map: any = {
        blue:  { bg: "rgba(37,99,235,.12)",  bd: "rgba(37,99,235,.35)",  fg: "#1e40af" },
        green: { bg: "rgba(5,150,105,.12)",  bd: "rgba(5,150,105,.35)",  fg: "#065f46" },
        slate: { bg: "rgba(100,116,139,.12)",bd: "rgba(100,116,139,.35)",fg: "#334155" },
        red:   { bg: "rgba(220,38,38,.12)",  bd: "rgba(220,38,38,.35)",  fg: "#7f1d1d" },
    };
    const s = map[color];
    return (
        <span style={{
            fontSize: 11, padding: "2px 6px", borderRadius: 999,
            background: s.bg, color: s.fg, border: `1px solid ${s.bd}`
        }}>{children}</span>
    );
}

function useQS() {
    const { search, hash } = useLocation();
    // hash-router 대응: #/library?room=CODE 형태 허용
    const part = hash.includes("?") ? hash.split("?")[1] : search.replace(/^\?/, "");
    return React.useMemo(() => new URLSearchParams(part), [part]);
}

// ---- Main ----
export default function PdfLibraryPage() {
    const nav = useNavigate();
    const qs = useQS();
    const roomCode = qs.get("room") || "";

    // UI state
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [decks, setDecks] = React.useState<DeckRow[]>([]);
    const [keyword, setKeyword] = React.useState("");
    const [view, setView] = React.useState<"all" | "pdf" | "copies">("all");
    const [slotSelGlobal, setSlotSelGlobal] = React.useState<number>(1);
    const [slotSel, setSlotSel] = React.useState<Record<string, number>>({}); // 카드별 교시 선택

    // room & slots
    const [roomId, setRoomId] = React.useState<string | null>(null);
    const [slots, setSlots] = React.useState<number[]>([]);

    // ===== room/slot helpers =====
    const getRoomIdByCode = React.useCallback(async (code: string): Promise<string> => {
        const { data, error } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
        if (error || !data?.id) throw error ?? new Error("room not found");
        return data.id as string;
    }, []);

    const ensureRoomId = React.useCallback(async () => {
        if (roomId) return roomId;
        const id = await getRoomIdByCode(roomCode);
        setRoomId(id);
        return id;
    }, [roomId, roomCode, getRoomIdByCode]);

    const refreshSlotsList = React.useCallback(async () => {
        try {
            const rid = await ensureRoomId();
            const { data, error } = await supabase
                .from("room_lessons").select("slot").eq("room_id", rid).order("slot", { ascending: true });
            if (error) throw error;
            const arr = (data || []).map((r: any) => Number(r.slot));
            setSlots(arr);
            if (arr.length && !arr.includes(slotSelGlobal)) setSlotSelGlobal(arr[0]);
        } catch (e) {
            console.error("refreshSlotsList", e);
        }
    }, [ensureRoomId, slotSelGlobal]);

    const createSlot = React.useCallback(async () => {
        try {
            const rid = await ensureRoomId();
            const used = new Set(slots);
            let next = 1; while (used.has(next) && next <= 12) next++;
            if (next > 12) { alert("더 이상 교시를 만들 수 없습니다."); return; }
            const { error } = await supabase
                .from("room_lessons")
                .upsert({ room_id: rid, slot: next, current_index: 0 }, { onConflict: "room_id,slot" });
            if (error) throw error;
            await refreshSlotsList();
            setSlotSelGlobal(next);
        } catch (e:any) { alert(e?.message ?? String(e)); }
    }, [ensureRoomId, slots, refreshSlotsList]);

    React.useEffect(() => { if (roomCode) ensureRoomId().then(refreshSlotsList); }, [roomCode]); // eslint-disable-line

    // ===== 목록 로드: RPC 우선 + 스토리지 병합 =====
    const fetchFromStorage = React.useCallback(async (limitFolders = 120): Promise<DeckRow[]> => {
        type SFile = { name: string };
        const bucket = supabase.storage.from("presentations");
        const top = await bucket.list("decks", { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
        if (top.error) throw top.error;
        const folders = (top.data || []).map((f: any) => f.name).filter(Boolean).slice(0, limitFolders);

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
    }, []);

    const load = React.useCallback(async () => {
        setLoading(true); setError(null);
        try {
            let merged: DeckRow[] = [];
            // 1) RPC (가능하면)
            try {
                const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                if (error) throw error;
                merged = (data || []).map((d: any) => ({
                    id: d.id, title: d.title ?? null, file_key: d.file_key ?? null, file_pages: d.file_pages ?? null, origin: "db" as const
                }));
            } catch {
                // 2) 폴백: 직접 decks 조회
                const { data, error } = await supabase
                    .from("decks").select("id,title,file_key,file_pages").not("file_key", "is", null).limit(200);
                if (!error) {
                    merged = (data || []).map((d: any) => ({
                        id: d.id, title: d.title ?? null, file_key: d.file_key ?? null, file_pages: d.file_pages ?? null, origin: "db" as const
                    }));
                }
            }
            // 3) 스토리지 원본 병합(중복 제거: file_key 기준)
            try {
                const sRows = await fetchFromStorage(120);
                const byKey = new Map<string, DeckRow>();
                for (const r of merged) if (r.file_key) byKey.set(r.file_key, r);
                for (const r of sRows) if (r.file_key && !byKey.has(r.file_key)) byKey.set(r.file_key, r);
                merged = Array.from(byKey.values());
            } catch {}

            setDecks(merged);
            if (merged.length === 0) setError("표시할 자료가 없습니다. (DB/RPC 또는 스토리지에 자료 없음)");
        } catch (e: any) {
            setError(e?.message || "목록을 불러오지 못했어요.");
        } finally {
            setLoading(false);
        }
    }, [fetchFromStorage]);

    React.useEffect(() => { load(); }, [load]);

    // ===== 업로드: 자료함으로 업로드 (변환기 그대로 재사용) =====
    const onUploaded = React.useCallback(() => {
        alert("업로드 완료! 목록을 갱신합니다.");
        load();
    }, [load]);

    // ===== 불러오기 =====
    async function createDeckFromFileKeyAndAssign(fileKey: string, roomId: string, slot: number) {
        // DB 덱 생성
        const ins = await supabase.from("decks").insert({ title: "Imported", is_temp: true }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

        // rooms/<roomId>/decks/<deckId>/slides-*.pdf 로 복제
        const ts = Date.now();
        const destKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;

        let copied = false;
        try {
            const { error } = await supabase.storage.from("presentations").copy(fileKey, destKey);
            if (!error) copied = true;
        } catch {}
        if (!copied) {
            const dl = await supabase.storage.from("presentations").download(fileKey);
            if (dl.error) throw dl.error;
            const up = await supabase.storage.from("presentations").upload(destKey, dl.data, { contentType: "application/pdf", upsert: true });
            if (up.error) throw up.error;
        }

        await supabase.from("decks").update({ file_key: destKey }).eq("id", newDeckId);
        await supabase.from("room_decks").upsert({ room_id: roomId, deck_id: newDeckId, slot }, { onConflict: "room_id,slot" });
        return newDeckId;
    }

    async function assignDeckToSlot(d: DeckRow, slot: number) {
        if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
        try {
            const rid = await ensureRoomId();

            if (d.origin === "db") {
                // DB 덱: RPC 우선 → 폴백 upsert
                try {
                    const { error } = await supabase.rpc("assign_room_deck_by_ext", { p_code: roomCode, p_deck_id: d.id, p_slot: slot });
                    if (error) throw error;
                } catch (e: any) {
                    const msg = String(e?.message || "");
                    const isMissing = msg.includes("Could not find the function") || e?.status === 404;
                    if (!isMissing) throw e;
                    const { error: upErr } = await supabase.from("room_decks").upsert(
                        { room_id: rid, slot, deck_id: d.id },
                        { onConflict: "room_id,slot" }
                    );
                    if (upErr) throw upErr;
                }
            } else {
                if (!d.file_key) throw new Error("파일이 없습니다.");
                await createDeckFromFileKeyAndAssign(d.file_key, rid, slot);
            }
            alert(`✅ ${slot}교시로 불러왔습니다.`);
        } catch (e: any) {
            console.error(e);
            alert(`불러오기 실패: ${e?.message || e}`);
        }
    }

    // ===== 삭제(정리) =====
    const deleteDeck = React.useCallback(async (d: DeckRow) => {
        if (d.origin === "db") {
            // DB 덱: RPC 시도 → 폴백 수동 삭제
            if (!confirm("이 덱을 삭제할까요? 연결된 교시 배정도 해제될 수 있습니다.")) return;
            try {
                try {
                    const { error } = await supabase.rpc("delete_deck_deep", { p_deck_id: d.id }); // 있으면 사용
                    if (error) throw error;
                } catch {
                    // 폴백: room_decks → decks → (가능하면 스토리지 폴더 제거)
                    await supabase.from("room_decks").delete().eq("deck_id", d.id);
                    const fileKey = d.file_key || "";
                    if (fileKey.includes(`/decks/${d.id}/`) || /rooms\/.+\/decks\/.+\//.test(fileKey)) {
                        // prefix 폴더 전체 삭제
                        const prefix = fileKey.split("/").slice(0, -1).join("/") + "/";
                        const list = await supabase.storage.from("presentations").list(prefix);
                        if (!list.error) {
                            const targets = (list.data || []).map((f: any) => `${prefix}${f.name}`);
                            if (targets.length) await supabase.storage.from("presentations").remove(targets);
                        }
                    }
                    await supabase.from("decks").delete().eq("id", d.id);
                }
                setDecks(prev => prev.filter(x => x.id !== d.id));
            } catch (e:any) {
                alert(e?.message ?? String(e));
            }
        } else {
            // 스토리지 원본 폴더 삭제
            if (!d.file_key) { alert("파일이 없습니다."); return; }
            if (!confirm("원본 PDF 폴더를 삭제할까요? (되돌릴 수 없습니다)")) return;
            try {
                // decks/<folder>/<file>.pdf → decks/<folder>/* 모두 삭제
                const parts = d.file_key.split("/");
                const folder = parts.slice(0, 2).join("/") === "decks" ? parts[1] : parts[parts.indexOf("decks") + 1];
                const prefix = `decks/${folder}`;
                const bucket = supabase.storage.from("presentations");
                const list = await bucket.list(prefix);
                if (list.error) throw list.error;
                const targets = (list.data || []).map((f: any) => `${prefix}/${f.name}`);
                if (targets.length) {
                    const rm = await bucket.remove(targets);
                    if (rm.error) throw rm.error;
                }
                setDecks(prev => prev.filter(x => x.id !== d.id));
            } catch (e:any) {
                alert(e?.message ?? String(e));
            }
        }
    }, []);

    // ===== 필터/검색 =====
    const filtered = React.useMemo(() => {
        let arr = decks;
        if (view !== "all") {
            arr = arr.filter(d => {
                const isPdf = (d.file_key || "").includes("/decks/");
                return view === "pdf" ? isPdf : !isPdf;
            });
        }
        if (!keyword.trim()) return arr;
        const k = keyword.trim().toLowerCase();
        return arr.filter(d =>
            (d.title || "").toLowerCase().includes(k) ||
            (d.file_key || "").toLowerCase().includes(k)
        );
    }, [decks, view, keyword]);

    // ===== Card helpers =====
    const tagAndColor = (d: DeckRow) => {
        const key = d.file_key || "";
        if (key.includes("/decks/")) return { label: "원본 PDF", color: "blue" as const };
        if (key.includes("/rooms/")) return { label: "복제본",   color: "green" as const };
        return { label: d.origin.toUpperCase(), color: "slate" as const };
    };
    const cardBorder = (color: string) => color === "blue"
        ? "1px solid rgba(37,99,235,.45)"
        : color === "green"
            ? "1px solid rgba(5,150,105,.45)"
            : "1px solid rgba(148,163,184,.35)";

    // ===== Render =====
    return (
        <div className="px-4 py-4 max-w-7xl mx-auto">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <button
                        className="px-3 py-2 rounded-md border border-slate-300"
                        onClick={() => nav(`/teacher?room=${encodeURIComponent(roomCode)}&mode=setup`)}
                    >← 뒤로</button>
                    <h1 className="text-xl font-semibold">자료함</h1>
                </div>
                <div className="text-sm opacity-70">room: <code>{roomCode || "(미지정)"}</code></div>
            </div>

            {/* 업로더(자료함으로 업로드) */}
            <div className="panel mb-4" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>자료함으로 업로드</div>
                <div style={{ fontSize: 12, opacity: .75, marginBottom: 8 }}>
                    PDF를 업로드하면 변환되어 자료함에 추가됩니다. (변환 완료 후 자동 갱신)
                </div>
                <PdfToSlidesUploader onFinished={onUploaded} />
            </div>

            {/* 교시 선택/생성 */}
            <div className="panel mb-4" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>교시</div>
                <select
                    className="px-2 py-1 border rounded-md text-sm"
                    value={slotSelGlobal}
                    onChange={(e) => setSlotSelGlobal(Number(e.target.value))}
                >
                    {slots.length ? slots.map(s => <option key={s} value={s}>{s}교시</option>) : <option value={1}>1교시</option>}
                </select>
                <button className="btn" onClick={createSlot}>＋ 새 교시</button>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className={`btn ${view==="all"?"":"opacity-70"}`} onClick={() => setView("all")}>전체</button>
                    <button className={`btn ${view==="pdf"?"":"opacity-70"}`} onClick={() => setView("pdf")}>원본 PDF</button>
                    <button className={`btn ${view==="copies"?"":"opacity-70"}`} onClick={() => setView("copies")}>복제본</button>
                </div>
            </div>

            {/* 검색 */}
            <div className="flex items-center gap-2 mb-4">
                <input
                    className="px-3 py-2 rounded-md border border-slate-300 w-full"
                    placeholder="제목/경로 검색…"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                />
                <button className="px-3 py-2 rounded-md border border-slate-300 bg-white" onClick={() => setKeyword("")}>초기화</button>
                <button className="btn" onClick={load} disabled={loading}>{loading ? "갱신 중…" : "목록 새로고침"}</button>
            </div>

            {error && <div className="text-red-600 mb-2">{error}</div>}

            {/* Grid */}
            <div
                style={{
                    display: "grid",
                    gap: 16,
                    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                    alignItems: "start",
                }}
            >
                {filtered.map((d) => {
                    const slot = slotSel[d.id] ?? slotSelGlobal;
                    const tag = tagAndColor(d);
                    return (
                        <div
                            key={d.id}
                            style={{
                                borderRadius: 14,
                                border: cardBorder(tag.color),
                                background: "#fff",
                                padding: 12,
                                display: "flex",
                                flexDirection: "column",
                            }}
                        >
                            <div className="text-sm font-medium line-clamp-2">{d.title || "Untitled"}</div>
                            <div className="text-[11px] opacity-60 mb-2">{d.origin === "db" ? "DB" : "Storage"}</div>

                            {d.file_key
                                ? <Thumb keyStr={d.file_key} badge={<Chip color={tag.color as any}>{tag.label}</Chip>} />
                                : <div className="h-[120px] bg-slate-100 rounded-md" />
                            }

                            <div className="mt-3 flex items-center gap-2">
                                {d.file_key && <OpenSignedLink fileKey={d.file_key}>링크 열기</OpenSignedLink>}
                                <button className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm ml-auto" onClick={() => openEdit(nav, roomCode, d)}>편집</button>
                                <button className="px-2 py-1 rounded-md border text-sm" onClick={() => deleteDeck(d)}>삭제</button>
                            </div>

                            {/* 불러오기(교시 지정) */}
                            <div className="mt-2 flex items-center gap-2">
                                <select
                                    className="px-2 py-1 border rounded-md text-sm"
                                    value={slot}
                                    onChange={(e) => setSlotSel((s) => ({ ...s, [d.id]: Number(e.target.value) }))}
                                >
                                    {(slots.length ? slots : [1,2,3,4,5,6]).map(n => <option key={n} value={n}>{n}교시</option>)}
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

// ===== helpers bound to UI items =====
function openEdit(nav: ReturnType<typeof useNavigate>, roomCode: string, d: DeckRow) {
    if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
    if (!d.file_key) { alert("파일이 없습니다."); return; }
    if (d.origin === "db") nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
    else nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(d.file_key)}`);
}

function OpenSignedLink({ fileKey, children }: { fileKey: string; children: React.ReactNode }) {
    const [href, setHref] = React.useState<string>("");
    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const u = await getPdfUrlFromKey(fileKey, { ttlSec: 1800 });
                if (alive) setHref(u);
            } catch { if (alive) setHref(""); }
        })();
        return () => { alive = false; };
    }, [fileKey]);
    return (
        <a
            className="px-2 py-1 rounded-md border text-sm"
            href={href || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { if (!href) e.preventDefault(); }}
        >
            {children}
        </a>
    );
}
