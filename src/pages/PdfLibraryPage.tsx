// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";

// ---- Types ----
type DeckRow = {
    id: string;                   // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null;      // presentations/* 경로
    file_pages: number | null;
    origin: "db" | "storage";     // DB(decks 테이블) vs storage-only(폴더 스캔)
};

// ---- Theme helpers ----
function usePrefersDark() {
    const [dark, setDark] = React.useState<boolean>(
        typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    React.useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const on = (e: MediaQueryListEvent) => setDark(e.matches);
        mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
        return () => {
            mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on);
        };
    }, []);
    return dark;
}

const chipPal = {
    blue:  { bgD: "rgba(59,130,246,.18)",  bgL: "rgba(59,130,246,.12)",  bdD: "rgba(59,130,246,.45)",  fgD: "#bfdbfe", fgL: "#1e40af" },
    green: { bgD: "rgba(16,185,129,.18)",  bgL: "rgba(16,185,129,.12)",  bdD: "rgba(16,185,129,.45)",  fgD: "#bbf7d0", fgL: "#065f46" },
    slate: { bgD: "rgba(148,163,184,.18)", bgL: "rgba(148,163,184,.12)", bdD: "rgba(148,163,184,.35)", fgD: "#e2e8f0", fgL: "#334155" },
    red:   { bgD: "rgba(239,68,68,.22)",   bgL: "rgba(239,68,68,.12)",   bdD: "rgba(239,68,68,.45)",   fgD: "#fecaca", fgL: "#7f1d1d" },
} as const;

function useQS() {
    const { search, hash } = useLocation();
    const part = hash.includes("?") ? hash.split("?")[1] : search.replace(/^\?/, "");
    return React.useMemo(() => new URLSearchParams(part), [part]);
}

// ---- Reusable UI ----
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "neutral" | "outline" | "danger" | "ghost";
    small?: boolean;
    pressed?: boolean; // 토글/세그먼트용
};

// === storage helpers (REPLACE/ADD) ===
async function listDir(bucket: string, prefix: string) {
    return await supabase.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
}

/** "decks/slug/.." 또는 "rooms/<room>/decks/<deckId>/.." → 상위 폴더 경로 */
function folderPrefixOfFileKey(fileKey: string) {
    if (!fileKey) return null;
    // 파일이면 상위 폴더로, 이미 폴더면 그대로
    return fileKey.endsWith("/") ? fileKey.replace(/\/+$/, "") : fileKey.split("/").slice(0, -1).join("/");
}

/** prefix 하위 모든 파일을 재귀적으로 수집해서 삭제 */
async function removeTree(bucket: string, prefix: string) {
    const b = supabase.storage.from(bucket);
    const root = prefix.replace(/\/+$/, "");
    const stack = [root];
    const files: string[] = [];

    while (stack.length) {
        const cur = stack.pop()!;
        const ls = await listDir(bucket, cur);
        if (ls.error) throw ls.error;

        for (const ent of ls.data || []) {
            const child = `${cur}/${ent.name}`; // 파일이든 폴더든 일단 경로 합침
            // 하위에 또 항목이 있는지 시도해 보고, 있으면 폴더로 간주(BFS)
            const probe = await listDir(bucket, child);
            if (!probe.error && (probe.data?.length || 0) > 0) {
                stack.push(child);
            } else {
                files.push(child);
            }
        }
    }

    if (files.length) {
        const rm = await b.remove(files);
        if (rm.error) throw rm.error;
    }

    // 폴더 자체 오브젝트가 파일로 존재할 가능성 낮지만, 혹시 모를 잔여도 제거 시도
    try { await b.remove([root]); } catch {}
}

function useBtnStyles(dark: boolean, { variant = "neutral", small, pressed }: BtnProps) {
    const base: React.CSSProperties = {
        borderRadius: 10,
        padding: small ? "6px 10px" : "8px 12px",
        fontSize: small ? 12 : 14,
        lineHeight: 1.1,
        transition: "all .15s ease",
        cursor: "pointer",
    };
    const ring = dark ? "rgba(148,163,184,.28)" : "rgba(148,163,184,.35)";
    const set = {
        primary: {
            background: pressed ? (dark ? "#4f46e5" : "#4338ca") : (dark ? "#6366f1" : "#4f46e5"),
            color: "#fff",
            border: "1px solid transparent",
        },
        neutral: {
            background: dark ? "rgba(30,41,59,.6)" : "#fff",
            color: dark ? "#e5e7eb" : "#111827",
            border: `1px solid ${ring}`,
        },
        outline: {
            background: "transparent",
            color: dark ? "#e5e7eb" : "#111827",
            border: `1px solid ${ring}`,
        },
        danger: {
            background: dark ? "rgba(239,68,68,.25)" : "rgba(239,68,68,.10)",
            color: dark ? "#fecaca" : "#7f1d1d",
            border: `1px solid ${dark ? "rgba(239,68,68,.45)" : "rgba(239,68,68,.45)"}`,
        },
        ghost: {
            background: pressed ? (dark ? "rgba(99,102,241,.18)" : "rgba(99,102,241,.12)") : "transparent",
            color: dark ? "#e5e7eb" : "#111827",
            border: `1px solid ${pressed ? (dark ? "rgba(99,102,241,.35)" : "rgba(99,102,241,.35)") : "transparent"}`,
        },
    } as const;
    return { ...base, ...set[variant] };
}

function Chip({ color, children }: { color: "blue" | "green" | "slate" | "red"; children: React.ReactNode }) {
    const dark = usePrefersDark();
    const pal = chipPal[color];
    return (
        <span style={{
            fontSize: 11, padding: "2px 6px", borderRadius: 999,
            background: dark ? pal.bgD : pal.bgL,
            color: dark ? pal.fgD : pal.fgL,
            border: `1px solid ${dark ? pal.bdD : pal.bdD}`
        }}>{children}</span>
    );
}

function OpenPublicLink({ fileKey, children }: { fileKey: string; children: React.ReactNode }) {
    const { data } = supabase.storage.from("presentations").getPublicUrl(fileKey);
    const href = data.publicUrl || "#";
    const dark = usePrefersDark();
    const style = useBtnStyles(dark, { variant: "outline", small: true });
    return (
        <a style={style} href={href} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}


// ---- Small utils ----

function usePublicUrl(key: string | null | undefined) {
    const [url, setUrl] = React.useState<string>("");
    React.useEffect(() => {
        if (!key) { setUrl(""); return; }
        const { data } = supabase.storage.from("presentations").getPublicUrl(key);
        setUrl(data.publicUrl || "");
    }, [key]);
    return url;
}


function Thumb({ keyStr, badge }: { keyStr: string; badge: React.ReactNode }) {
    const fileUrl = usePublicUrl(keyStr);
    const dark = usePrefersDark();
    return (
        <div
            style={{
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                border: `1px solid ${dark ? "rgba(148,163,184,.22)" : "rgba(148,163,184,.35)"}`,
                height: 120,
                display: "grid",
                placeItems: "center",
                background: dark ? "rgba(2,6,23,.65)" : "#fff",
            }}
        >
            {fileUrl
                ? <PdfViewer fileUrl={fileUrl} page={1} maxHeight="120px" />
                : <div style={{ width: "100%", display: "grid", placeItems: "center", maxHeight: 120, overflow: "hidden" }}>
                    <div style={{ fontSize: 12, opacity: 0.7, padding: 8, color: dark ? "#cbd5e1" : "#475569" }}>
                        파일을 불러올 수 없습니다.
                    </div>
                </div>
            }
            <div style={{ position: "absolute", top: 6, left: 6 }}>{badge}</div>
        </div>
    );
}

// ---- Main ----
export default function PdfLibraryPage() {
    const nav = useNavigate();
    const qs = useQS();
    const roomCode = qs.get("room") || "";
    const dark = usePrefersDark();

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
            try {
                const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                if (error) throw error;
                merged = (data || []).map((d: any) => ({
                    id: d.id, title: d.title ?? null, file_key: d.file_key ?? null, file_pages: d.file_pages ?? null, origin: "db" as const
                }));
            } catch {
                const { data, error } = await supabase
                    .from("decks").select("id,title,file_key,file_pages").not("file_key", "is", null).limit(200);
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
            setDecks(merged);
            if (merged.length === 0) setError("표시할 자료가 없습니다. (DB/RPC 또는 스토리지에 자료 없음)");
        } catch (e: any) {
            setError(e?.message || "목록을 불러오지 못했어요.");
        } finally {
            setLoading(false);
        }
    }, [fetchFromStorage]);

    React.useEffect(() => { load(); }, [load]);

    // ===== 업로드 완료 → 새로고침 =====
    const onUploaded = React.useCallback(() => { load(); }, [load]);

    // ===== 불러오기 =====
    async function createDeckFromFileKeyAndAssign(fileKey: string, roomId: string, slot: number) {
        const ins = await supabase.from("decks").insert({ title: "Imported", is_temp: true }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;

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
        // UX: 낙관적 제거
        setDecks(prev => prev.filter(x => x.id !== d.id));

        try {
            const bucket = "presentations";
            const prefix = d.file_key ? folderPrefixOfFileKey(d.file_key) : null;

            if (d.origin === "db") {
                // 1) DB 연결 해제/삭제 (RPC 있으면 우선 사용)
                try {
                    const { error } = await supabase.rpc("delete_deck_deep", { p_deck_id: d.id });
                    if (error) throw error;
                } catch {
                    await supabase.from("room_decks").delete().eq("deck_id", d.id);
                    const del = await supabase.from("decks").delete().eq("id", d.id);
                    if (del.error) throw del.error;
                }

                // 2) 스토리지 정리 (원본/복제본 모두 커버)
                if (prefix) await removeTree(bucket, prefix);
            } else {
                // origin === "storage" (DB에 행 없는 "원본" 폴더)
                if (!prefix) throw new Error("file_key 없음");
                await removeTree(bucket, prefix);
            }

            // (안전망) 정말 비었는지 확인 후 동기화
            if (prefix) {
                const ls = await supabase.storage.from(bucket).list(prefix);
                if (!ls.error && (ls.data?.length || 0) > 0) {
                    // 잔여가 있다면 한 번 더 재귀 삭제 (경쟁 상태 대비)
                    await removeTree(bucket, prefix);
                }
            }
        } catch (e: any) {
            // 실패 시 목록 복구 + 알림
            await load();
            alert(e?.message ?? String(e));
            return;
        }

        // 최종 동기화
        await load();
    }, [load]);


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

    const tagAndColor = (d: DeckRow) => {
        const key = d.file_key || "";
        if (key.includes("/decks/")) return { label: "원본 PDF", color: "blue" as const };
        if (key.includes("/rooms/")) return { label: "복제본",   color: "green" as const };
        return { label: d.origin.toUpperCase(), color: "slate" as const };
    };

    // 카드 스타일(다크/라이트 자동 조정)
    const cardBase: React.CSSProperties = {
        borderRadius: 14,
        background: dark ? "rgba(15,23,42,.92)" : "#fff", // slate-900 유사
        border: `1px solid ${dark ? "rgba(148,163,184,.18)" : "rgba(148,163,184,.35)"}`,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: dark ? "0 6px 18px rgba(2,6,23,.55)" : "0 4px 14px rgba(15,23,42,.08)",
    };

    const Btn = (p: BtnProps) => <button {...p} style={{ ...useBtnStyles(dark, p), ...(p.style || {}) }}>{p.children}</button>;

    return (
        <div className="px-4 py-4 max-w-7xl mx-auto">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Btn variant="outline" onClick={() => nav(`/teacher?room=${encodeURIComponent(roomCode)}&mode=setup`)} small>← 뒤로</Btn>
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

            {/* 교시 + 필터 */}
            <div className="panel mb-4" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>교시</div>
                <select
                    className="px-2 py-1 border rounded-md text-sm"
                    value={slotSelGlobal}
                    onChange={(e) => setSlotSelGlobal(Number(e.target.value))}
                >
                    {slots.length ? slots.map(s => <option key={s} value={s}>{s}교시</option>) : <option value={1}>1교시</option>}
                </select>
                <Btn onClick={createSlot} small variant="neutral">＋ 새 교시</Btn>

                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <Btn small variant="ghost" pressed={view==="all"} onClick={() => setView("all")}>전체</Btn>
                    <Btn small variant="ghost" pressed={view==="pdf"} onClick={() => setView("pdf")}>원본 PDF</Btn>
                    <Btn small variant="ghost" pressed={view==="copies"} onClick={() => setView("copies")}>복제본</Btn>
                </div>
            </div>

            {/* 검색/갱신 */}
            <div className="flex items-center gap-2 mb-4">
                <input
                    className="px-3 py-2 rounded-md border border-slate-300 w-full"
                    placeholder="제목/경로 검색…"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                />
                <Btn small variant="outline" onClick={() => setKeyword("")}>초기화</Btn>
                <Btn small variant="neutral" onClick={load} disabled={loading}>{loading ? "갱신 중…" : "목록 새로고침"}</Btn>
            </div>

            {error && <div className="text-red-600 mb-2">{error}</div>}

            {/* Grid */}
            <div
                style={{
                    display: "grid",
                    gap: 16,
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    alignItems: "start",
                }}
            >
                {filtered.map((d) => {
                    const slot = slotSel[d.id] ?? slotSelGlobal;
                    const tag = tagAndColor(d);
                    return (
                        <div key={d.id} style={cardBase}>
                            <div className="text-sm font-medium line-clamp-2" style={{ color: dark ? "#e5e7eb" : "#111827" }}>
                                {d.title || "Untitled"}
                            </div>
                            <div className="text-[11px] opacity-60 mb-2">{d.origin === "db" ? "DB" : "Storage"}</div>

                            {d.file_key
                                ? <Thumb keyStr={d.file_key} badge={<Chip color={tag.color as any}>{tag.label}</Chip>} />
                                : <div style={{ height: 120, borderRadius: 12, background: dark ? "rgba(2,6,23,.65)" : "#f1f5f9" }} />
                            }

                            <div className="mt-3 flex items-center gap-8">
                                {d.file_key && <OpenPublicLink fileKey={d.file_key}>링크 열기</OpenPublicLink>}
                                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                    <Btn small variant="neutral" onClick={() => openEdit(nav, roomCode, d)}>편집</Btn>
                                    <Btn small variant="danger" onClick={() => deleteDeck(d)}>삭제</Btn>
                                </div>
                            </div>

                            {/* 불러오기(교시 지정) */}
                            <div className="mt-2 flex items-center gap-6">
                                <select
                                    className="px-2 py-1 border rounded-md text-sm"
                                    value={slot}
                                    onChange={(e) => setSlotSel((s) => ({ ...s, [d.id]: Number(e.target.value) }))}
                                >
                                    {(slots.length ? slots : [1,2,3,4,5,6]).map(n => <option key={n} value={n}>{n}교시</option>)}
                                </select>
                                <Btn small variant="primary" onClick={() => assignDeckToSlot(d, slot)}>지금 불러오기</Btn>
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
