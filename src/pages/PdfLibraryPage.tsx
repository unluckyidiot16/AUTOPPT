// src/pages/PdfLibraryPage.tsx (WebP-only)
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";
import { useRealtime } from "../hooks/useRealtime";
import { slidesPrefixOfAny, signedSlidesUrl } from "../utils/supaFiles";

// ───────────────────────────────────────────────────────────────────────────────
// Types (file_key = 항상 "slides" 버킷 상대 프리픽스)
type DeckRow = {
    id: string;               // DB 덱이면 uuid, 스토리지 항목이면 "s:<slides_prefix>"
    title: string | null;
    file_key: string | null;  // "decks/<slug>" 또는 "rooms/<room>/decks/<deckId>"
    file_pages: number | null;
    origin: "db" | "storage"; // DB(decks) vs storage-only(폴더 스캔)
};

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
function useQS() {
    const { search, hash } = useLocation();
    const part = hash.includes("?") ? hash.split("?")[1] : search.replace(/^\?/, "");
    return React.useMemo(() => new URLSearchParams(part), [part]);
}
function isImage(name: string) { return /\.webp$|\.png$|\.jpg$/i.test(name); }
function deckSlidesPrefix(deckId: string, roomId: string) {
    return `rooms/${roomId}/decks/${deckId}`;
}
async function getRoomIdByCode(roomCode: string) {
    const { data, error } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
    if (error || !data?.id) throw new Error("ROOM_NOT_FOUND");
    return data.id as string;
}
async function ensureSlotRow(roomId: string, slot: number) {
      try {
            const { error } = await supabase
              .from("room_lessons")
              .upsert({ room_id: roomId, slot, current_index: 0 }, { onConflict: "room_id,slot" });
            if (error) throw error;
          } catch (e:any) {
            // room_lessons 테이블이 없는 설치에서도 배정은 진행되도록 무시
                console.warn("[ensureSlotRow] skipped:", e?.message || e);
          }
    }


async function setCurrentDeck(roomId: string, deckId: string) {
      try {
            await supabase.from("rooms").update({ current_deck_id: deckId }).eq("id", roomId);
          } catch (e) {
            console.warn("[setCurrentDeck] fail", e);
          }
    }

function usePrefersDark() {
    const [dark, setDark] = React.useState<boolean>(
        typeof window !== "undefined" &&
        (window as any).matchMedia &&
        (window as any).matchMedia("(prefers-color-scheme: dark)").matches,
    );
    React.useEffect(() => {
        if (typeof window === "undefined" || !(window as any).matchMedia) return;
        const mq: MediaQueryList = (window as any).matchMedia("(prefers-color-scheme: dark)");
        const on = (e: MediaQueryListEvent) => setDark(e.matches);
        (mq as any).addEventListener ? (mq as any).addEventListener("change", on) : (mq as any).addListener(on);
        return () => {
            (mq as any).removeEventListener ? (mq as any).removeEventListener("change", on) : (mq as any).removeListener(on);
        };
    }, []);
    return dark;
}

// slides 개수
async function countSlides(prefix: string) {
    const { data, error } = await supabase.storage.from("slides").list(prefix, { limit: 1000 });
    if (error) return 0;
    return (data ?? []).filter(f => isImage(f.name)).length;
}

// .done.json → pages, 없으면 webp 개수
async function readPagesFromDoneOrList(prefix: string): Promise<number> {
    const done = await supabase.storage.from("slides").download(`${prefix}/.done.json`);
    if (!done.error) {
        try {
            const meta = JSON.parse(await done.data.text());
            const pages = Number(meta?.pages);
            if (Number.isFinite(pages) && pages > 0) return pages;
        } catch {}
    }
    const { data, error } = await supabase.storage.from("slides").list(prefix);
    if (!error && data?.length) {
        return data.filter((f) => /\.webp$/i.test(f.name)).length;
    }
    return 0;
}

// slides 복사(FALLBACK: download→upload)
async function copySlidesDir(
    srcPrefix: string,
    destPrefix: string,
    onStep?: (copied: number, total: number) => void,
) {
    const slides = supabase.storage.from("slides");

    async function listAll(prefix: string): Promise<string[]> {
        const out: string[] = [];
        const stack = [prefix.replace(/\/+$/, "")];
        while (stack.length) {
            const cur = stack.pop()!;
            const ls = await slides.list(cur);
            if (ls.error) throw ls.error;
            for (const ent of ls.data || []) {
                const child = `${cur}/${ent.name}`;
                const probe = await slides.list(child);
                if (!probe.error && (probe.data?.length || 0) > 0) stack.push(child);
                else out.push(child);
            }
        }
        return out;
    }

    const files = await listAll(srcPrefix);
    const total = files.length || 0;
    if (!total) return 0;

    let copied = 0;
    for (const srcPath of files) {
        const rel = srcPath.slice(srcPrefix.length).replace(/^\/+/, "");
        const dstPath = `${destPrefix}/${rel}`;
        const { error: cErr } = await slides.copy(srcPath, dstPath);
        if (cErr) {
            const dl = await slides.download(srcPath);
            if (dl.error) throw dl.error;
            const up = await slides.upload(dstPath, dl.data, { upsert: true });
            if (up.error) throw up.error;
        }
        copied++;
        onStep?.(copied, total);
    }
    return copied;
}

// .done.json 기반 빠른 복사
async function copySlidesFastByDone(
    slidesPrefixSrc: string,
    slidesPrefixDst: string,
    onStep?: (copied: number, total: number) => void,
) {
    const slides = supabase.storage.from("slides");
    const doneKey = `${slidesPrefixSrc}/.done.json`;
    const done = await slides.download(doneKey);
    if (done.error) throw done.error;
    const meta = JSON.parse(await done.data.text()) as { pages: number };
    const total = Math.max(0, Number(meta.pages) || 0);
    if (!total) return 0;

    const targets = Array.from({ length: total }, (_, i) => `${slidesPrefixSrc}/${i}.webp`);
    targets.push(doneKey);

    let copied = 0;
    for (const src of targets) {
        const dst = src.replace(slidesPrefixSrc, slidesPrefixDst);
        const { error: cErr } = await slides.copy(src, dst);
        if (cErr) {
            const dl = await slides.download(src);
            if (dl.error) throw dl.error;
            const up = await slides.upload(dst, dl.data, { upsert: true });
            if (up.error) throw up.error;
        }
        copied++;
        onStep?.(copied, targets.length);
    }
    return copied;
}

async function copySlidesIfMissing(fromPrefix: string, toPrefix: string) {
    const dst = await supabase.storage.from("slides").list(toPrefix, { limit: 2 });
    if ((dst.data ?? []).length > 0) return; // 이미 있음
    const src = await supabase.storage.from("slides").list(fromPrefix, { limit: 1000 });
    for (const f of src.data ?? []) {
        if (!isImage(f.name) && f.name !== ".done.json") continue;
        await supabase.storage.from("slides").copy(`${fromPrefix}/${f.name}`, `${toPrefix}/${f.name}`);
    }
}

// 유실 감지 (slides 폴더 존재 여부 체크)
async function findMissingBySlides(rows: DeckRow[]) {
    const missing: DeckRow[] = [];
    for (const r of rows) {
        if (!r.file_key) continue;
        const ls = await supabase.storage.from("slides").list(r.file_key);
        if (!ls.error && (ls.data?.length || 0) > 0) continue;
        missing.push(r);
    }
    return missing;
}
async function detachMissingFileKeys(rows: DeckRow[]) {
    const targets = rows.filter((r) => r.origin !== "storage" && r.file_key).map((r) => r.id);
    if (!targets.length) return;
    await supabase.from("decks").update({ file_key: null, file_pages: null }).in("id", targets);
}

// ───────────────────────────────────────────────────────────────────────────────
// Small UI
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "neutral" | "outline" | "danger" | "ghost";
    small?: boolean;
    pressed?: boolean;
};
const chipPal = {
    blue:  { bgD: "rgba(59,130,246,.18)",  bgL: "rgba(59,130,246,.12)",  bdD: "rgba(59,130,246,.45)",  fgD: "#bfdbfe", fgL: "#1e40af" },
    green: { bgD: "rgba(16,185,129,.18)",  bgL: "rgba(16,185,129,.12)",  bdD: "rgba(16,185,129,.45)",  fgD: "#bbf7d0", fgL: "#065f46" },
    slate: { bgD: "rgba(148,163,184,.18)", bgL: "rgba(148,163,184,.12)", bdD: "rgba(148,163,184,.35)", fgD: "#e2e8f0", fgL: "#334155" },
    red:   { bgD: "rgba(239,68,68,.22)",  bgL: "rgba(239,68,68,.12)",  bdD: "rgba(239,68,68,.45)",  fgD: "#fecaca", fgL: "#7f1d1d" },
} as const;
function useBtnStyles(dark: boolean, { variant = "neutral", small, pressed }: BtnProps) {
    const base: React.CSSProperties = {
        borderRadius: 10, padding: small ? "6px 10px" : "8px 12px",
        fontSize: small ? 12 : 14, lineHeight: 1.1, transition: "all .15s ease", cursor: "pointer",
    };
    const ring = dark ? "rgba(148,163,184,.28)" : "rgba(148,163,184,.35)";
    const set = {
        primary: { background: pressed ? (dark ? "#4f46e5" : "#4338ca") : (dark ? "#6366f1" : "#4f46e5"), color: "#fff", border: "1px solid transparent" },
        neutral: { background: dark ? "rgba(30,41,59,.6)" : "#fff", color: dark ? "#e5e7eb" : "#111827", border: `1px solid ${ring}` },
        outline: { background: "transparent", color: dark ? "#e5e7eb" : "#111827", border: `1px solid ${ring}` },
        danger:  { background: dark ? "rgba(239,68,68,.25)" : "rgba(239,68,68,.10)", color: dark ? "#fecaca" : "#7f1d1d", border: `1px solid rgba(239,68,68,.45)` },
        ghost:   { background: pressed ? (dark ? "rgba(99,102,241,.18)" : "rgba(99,102,241,.12)") : "transparent", color: dark ? "#e5e7eb" : "#111827", border: `1px solid ${pressed ? "rgba(99,102,241,.35)" : "transparent"}` },
    } as const;
    return { ...base, ...set[variant] };
}
function Chip({ color, children }: { color: "blue" | "green" | "slate" | "red"; children: React.ReactNode }) {
    const dark = usePrefersDark(); const pal = chipPal[color];
    return (
        <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: dark ? pal.bgD : pal.bgL, color: dark ? pal.fgD : pal.fgL, border: `1px solid ${dark ? pal.bdD : pal.bdD}` }}>
      {children}
    </span>
    );
}

// 카드 썸네일 (slides/0.webp)
function Thumb({ prefix, badge }: { prefix: string; badge: React.ReactNode }) {
    const dark = usePrefersDark();
    const key0 = `${prefix}/0.webp`;
    const [url, setUrl] = React.useState<string | null>(null);
    const [ok, setOk] = React.useState<boolean>(true);

    React.useEffect(() => {
        let off = false;
        (async () => {
            const u = await signedSlidesUrl(key0, 1800);
            if (!off) setUrl(u);
        })();
        return () => { off = true; };
    }, [key0]);

    React.useEffect(() => { setOk(true); }, [url]);

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
            {url && ok ? (
                <img
                    src={url}
                    alt="slide thumb"
                    style={{ maxHeight: 120, width: "100%", objectFit: "contain" }}
                    onError={() => setOk(false)}
                    loading="eager"
                />
            ) : (
                <div style={{ fontSize: 12, opacity: 0.7, padding: 8, color: dark ? "#cbd5e1" : "#475569" }}>
                    슬라이드 썸네일이 아직 없어요. (변환/복사 대기)
                </div>
            )}
            <div style={{ position: "absolute", top: 6, left: 6 }}>{badge}</div>
        </div>
    );
}

// 첫 페이지 열기 (0.webp)
function OpenFirstSlideLink({ prefix, children }: { prefix: string; children: React.ReactNode }) {
    const [href, setHref] = React.useState("#");
    const dark = usePrefersDark();
    const style = useBtnStyles(dark, { variant: "outline", small: true });
    React.useEffect(() => {
        let off = false;
        (async () => {
            const u = await signedSlidesUrl(`${prefix}/0.webp`, 7 * 24 * 3600);
            if (!off) setHref(u);
        })();
        return () => { off = true; };
    }, [prefix]);
    return <a style={style} href={href} target="_blank" rel="noreferrer">{children}</a>;
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
export default function PdfLibraryPage() {
    const nav = useNavigate();
    const qs = useQS();
    const roomCode = qs.get("room") || "";
    const dark = usePrefersDark();

    // 실시간 브로드캐스트 (학생 쪽 manifest 갱신)
    const { sendRefresh } = useRealtime(roomCode || "");

    // 진행 모달
    const [assign, setAssign] = React.useState<{ open: boolean; progress: number; text: string; deckId: string | null; logs: string[]; }>(
        { open: false, progress: 0, text: "", deckId: null, logs: [] },
    );
    const logAssign = React.useCallback((m: string) => setAssign((a) => ({ ...a, logs: [...a.logs, m].slice(-300) })), []);

    // UI state
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [decks, setDecks] = React.useState<DeckRow[]>([]);
    const [keyword, setKeyword] = React.useState("");
    const [view, setView] = React.useState<"all" | "originals" | "copies">("all");
    const [slotSelGlobal, setSlotSelGlobal] = React.useState<number>(1);
    const [slotSel, setSlotSel] = React.useState<Record<string, number>>({});

    // room & slots
    const [roomId, setRoomId] = React.useState<string | null>(null);
    const [slots, setSlots] = React.useState<number[]>([]);

    const ensureRoomId = React.useCallback(async () => {
        if (roomId) return roomId;
        const id = await getRoomIdByCode(roomCode); setRoomId(id); return id;
    }, [roomId, roomCode]);

    const refreshSlotsList = React.useCallback(async () => {
        try {
            const rid = await ensureRoomId();
            const { data, error } = await supabase.from("room_lessons").select("slot").eq("room_id", rid).order("slot", { ascending: true });
            if (error) throw error;
            const arr = (data || []).map((r: any) => Number(r.slot));
            setSlots(arr);
            if (arr.length && !arr.includes(slotSelGlobal)) setSlotSelGlobal(arr[0]);
        } catch (e) { console.error("refreshSlotsList", e); }
    }, [ensureRoomId, slotSelGlobal]);
    React.useEffect(() => { if (roomCode) ensureRoomId().then(refreshSlotsList); }, [roomCode]); // eslint-disable-line

    // Storage: slides/decks/* 스캔하여 원본 목록 구성
    const fetchFromStorage = React.useCallback(async (limitFolders = 120): Promise<DeckRow[]> => {
        const slides = supabase.storage.from("slides");
        const top = await slides.list("decks", { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
        if (top.error) throw top.error;
        const folders = (top.data || []).map((f: any) => f.name).filter(Boolean).slice(0, limitFolders);

        const rows: DeckRow[] = [];
        for (const folder of folders) {
            const prefix = `decks/${folder}`;
            const ls = await slides.list(prefix, { limit: 5, sortBy: { column: "updated_at", order: "desc" } });
            if (ls.error) continue;
            const hasThumb = (ls.data ?? []).some((f: any) => f.name === "0.webp");
            const hasAny = (ls.data ?? []).some((f: any) => isImage(f.name));
            if (!hasThumb && !hasAny) continue;
            rows.push({ id: `s:${prefix}`, title: folder, file_key: prefix, file_pages: null, origin: "storage" });
            if (rows.length >= 200) break;
        }
        return rows;
    }, []);

    // 목록 로드 (DB + Storage 병합) & 유실 감지
    const load = React.useCallback(async () => {
        setLoading(true); setError(null);
        try {
            let merged: DeckRow[] = [];

            // DB 우선
            try {
                const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                if (error) throw error;
                merged = (data || []).map((d: any) => ({
                    id: d.id, title: d.title ?? null,
                    file_key: slidesPrefixOfAny(d.file_key ?? null), // 혹시 예전 값이어도 정규화
                    file_pages: d.file_pages ?? null, origin: "db" as const
                }));
            } catch {
                const { data, error } = await supabase.from("decks").select("id,title,file_key,file_pages").limit(200);
                if (!error) merged = (data || []).map((d: any) => ({
                    id: d.id, title: d.title ?? null,
                    file_key: slidesPrefixOfAny(d.file_key ?? null),
                    file_pages: d.file_pages ?? null, origin: "db" as const
                }));
            }

            // Storage 병합(slides/decks/*)
            try {
                const sRows = await fetchFromStorage(120);
                const byKey = new Map<string, DeckRow>();
                for (const r of merged) if (r.file_key) byKey.set(r.file_key, r);
                for (const r of sRows) if (r.file_key && !byKey.has(r.file_key)) byKey.set(r.file_key, r);
                merged = Array.from(byKey.values());
            } catch {}

            // 유실 감지 (slides 없음)
            const missingRows = await findMissingBySlides(merged);
            const missingIds = new Set(missingRows.map((m) => m.id));
            const visible = merged.filter((r) => !r.file_key || !missingIds.has(r.id));
            setDecks(visible);

            if (merged.length === 0) setError("표시할 자료가 없습니다. (DB 또는 slides 스토리지에 자료 없음)");
        } catch (e: any) {
            setError(e?.message || "목록을 불러오지 못했어요.");
        } finally {
            setLoading(false);
        }
    }, [fetchFromStorage]);
    React.useEffect(() => { load(); }, [load]);

    const onUploaded = React.useCallback(() => { load(); }, [load]);

    // 분류 (slides prefix 기준)
    function classifyPath(key: string | null | undefined) {
        const p = (key || "");
        const isCopy = p.startsWith("rooms/");
        const isOriginal = p.startsWith("decks/");
        return { isCopy, isOriginal };
    }

    // DB 덱을 현재 ROOM 전용 prefix로 보정(필요 시 슬라이드 복사 + pages 업데이트)
    async function ensureDeckIsLocalToRoom(deck: DeckRow, roomCode: string) {
        const roomId = await getRoomIdByCode(roomCode);
        const toPrefix = deckSlidesPrefix(deck.id, roomId); // rooms/<room>/decks/<deckId>

        const curKey = slidesPrefixOfAny(deck.file_key ?? "") || "";
        if (curKey !== toPrefix) {
            if (curKey) {
                await copySlidesIfMissing(curKey, toPrefix);
            }
            const pages = await readPagesFromDoneOrList(toPrefix);
            const { error } = await supabase.from("decks").update({ file_key: toPrefix, file_pages: pages || null }).eq("id", deck.id);
            if (error) throw error;
            return { roomId, pages, file_key: toPrefix };
        } else {
            // 이미 현 방용 프리픽스 → pages만 보정
            const pages = await readPagesFromDoneOrList(toPrefix);
            if ((deck.file_pages ?? 0) !== pages) {
                await supabase.from("decks").update({ file_pages: pages || null }).eq("id", deck.id);
            }
            return { roomId, pages, file_key: toPrefix };
        }
    }

    // 원본(slides/decks/<slug>)을 복제하여 새 DB 덱 생성 후 배정
    async function createDeckFromFileKeyAndAssign(slidesPrefixSrc: string, roomId: string, slot: number, title?: string | null) {
        await ensureSlotRow(roomId, slot);

        // A) 새 덱
        const ins = await supabase.from("decks").insert({ title: title ?? "Imported" }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;
        logAssign(`덱 생성: ${newDeckId}`);

        // B) slides 복사
        const dstSlidesPrefix = `rooms/${roomId}/decks/${newDeckId}`;
        logAssign(`slides: src=${slidesPrefixSrc} → dst=${dstSlidesPrefix}`);
        try {
            logAssign(`슬라이드 복사 준비(.done.json 확인)…`);
            await copySlidesFastByDone(slidesPrefixSrc, dstSlidesPrefix, (copied, total) => {
                const pct = Math.max(12, Math.min(98, Math.floor(12 + (copied / Math.max(1, total)) * 85)));
                setAssign((a) => ({ ...a, progress: pct, text: `슬라이드 복사 중… ${copied}/${total}` }));
            });
            logAssign(`슬라이드 복사 완료(FAST): slides/${dstSlidesPrefix}`);
        } catch {
            logAssign(`FAST 복사 실패 → 재귀 복사 진행`);
            await copySlidesDir(slidesPrefixSrc, dstSlidesPrefix, (copied, total) => {
                const pct = Math.max(12, Math.min(98, Math.floor(12 + (copied / Math.max(1, total)) * 85)));
                setAssign((a) => ({ ...a, progress: pct, text: `슬라이드 복사 중… ${copied}/${total}` }));
            });
            logAssign(`슬라이드 복사 완료(FALLBACK): slides/${dstSlidesPrefix}`);
        }

        // C) pages 기록 + 덱 메타 갱신 (file_key = slides prefix)
        const pages = await readPagesFromDoneOrList(dstSlidesPrefix);
        await supabase.from("decks").update({ file_key: dstSlidesPrefix, file_pages: pages || null }).eq("id", newDeckId);

        // D) room_decks 배정
        await supabase.from("room_decks").upsert({ room_id: roomId, slot, deck_id: newDeckId }, { onConflict: "room_id,slot" });
        await setCurrentDeck(roomId, newDeckId);
        return { newDeckId };
    }

    // DB 복제본(rooms/*) 그대로 배정 (필요 시 로컬화 보정)
    async function assignExistingDbCopyToSlot(deck: DeckRow, slot: number) {
        const { roomId } = await ensureDeckIsLocalToRoom(deck, roomCode);
        await supabase.from("room_lessons").upsert({ room_id: roomId, slot, current_index: 0 }, { onConflict: "room_id,slot" });
        const { error } = await supabase.from("room_decks").upsert(
            { room_id: roomId, slot, deck_id: deck.id },
            { onConflict: "room_id,slot" }
        );
        if (error) throw error;
        await setCurrentDeck(roomId, deck.id);
        sendRefresh?.("manifest");
    }

    // 액션
    async function handleAssign(d: DeckRow, slot: number) {
        if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
        if (!d.file_key) { alert("파일이 없습니다."); return; }

        const rid = await ensureRoomId();
        const { isCopy, isOriginal } = classifyPath(d.file_key);

        try {
            setAssign({ open: true, progress: 8, text: isCopy ? "기존 덱 배정 중…" : "사본 생성 중…", deckId: null, logs: [] });
            logAssign(`시작: room=${rid}, slot=${slot}, key=${d.file_key}`);

            if (isCopy && d.origin === "db") {
                await assignExistingDbCopyToSlot(d, slot);
                setAssign((a) => ({ ...a, progress: 100, text: "배정 완료!" }));
            } else if (isOriginal) {
                const { newDeckId } = await createDeckFromFileKeyAndAssign(d.file_key, rid, slot, d.title);
                setAssign((a) => ({ ...a, deckId: newDeckId, progress: 100, text: "복제 및 배정 완료!" }));
            } else {
                // storage-only로 들어온 원본도 동일 처리
                const { newDeckId } = await createDeckFromFileKeyAndAssign(d.file_key, rid, slot, d.title);
                setAssign((a) => ({ ...a, deckId: newDeckId, progress: 100, text: "복제 및 배정 완료!" }));
            }

            await load();              // 자료함 카드 갱신
            sendRefresh?.("manifest"); // 학생 페이지 갱신
        } catch (e: any) {
            console.error(e);
            logAssign(`에러: ${e?.message || e}`);
            setAssign((a) => ({ ...a, text: `에러: ${e?.message || e}` }));
            alert(`불러오기 실패: ${e?.message || e}`);
        } finally {
            setTimeout(() => setAssign({ open: false, progress: 0, text: "", deckId: null, logs: [] }), 650);
        }
    }

    // 삭제 (slides만 정리; DB 행도 제거)
    const deleteDeck = React.useCallback(async (d: DeckRow) => {
        setDecks((prev) => prev.filter((x) => x.id !== d.id)); // 낙관적 UI
        try {
            const slidesPrefix = d.file_key ?? null;

            if (d.origin === "db") {
                try {
                    const { error } = await supabase.rpc("delete_deck_deep", { p_deck_id: d.id });
                    if (error) throw error;
                } catch {
                    await supabase.from("room_decks").delete().eq("deck_id", d.id);
                    const del = await supabase.from("decks").delete().eq("id", d.id);
                    if (del.error) throw del.error;
                }
                if (slidesPrefix) await removeTree("slides", slidesPrefix);
            } else {
                if (!slidesPrefix) throw new Error("file_key 없음");
                await removeTree("slides", slidesPrefix);
            }

        } catch (e: any) {
            await load();
            alert(e?.message ?? String(e));
            return;
        }
        await load();
    }, [load]);

    // slides 트리 삭제
    async function removeTree(bucket: string, prefix: string) {
        const b = supabase.storage.from(bucket);
        const root = prefix.replace(/\/+$/, "");
        const stack = [root];
        const files: string[] = [];
        while (stack.length) {
            const cur = stack.pop()!;
            const ls = await b.list(cur, { limit: 1000 });
            if (ls.error) throw ls.error;
            for (const ent of ls.data || []) {
                const child = `${cur}/${ent.name}`;
                const probe = await b.list(child, { limit: 1000 });
                if (!probe.error && (probe.data?.length || 0) > 0) stack.push(child);
                else files.push(child);
            }
        }
        if (files.length) {
            const rm = await b.remove(files);
            if (rm.error) throw rm.error;
        }
        try { await b.remove([root]); } catch {}
    }

    // 필터
    const filtered = React.useMemo(() => {
        let arr = decks;
        if (view !== "all") {
            arr = arr.filter((d) => {
                const { isCopy, isOriginal } = classifyPath(d.file_key);
                return view === "originals" ? isOriginal : isCopy;
            });
        }
        if (!keyword.trim()) return arr;
        const k = keyword.trim().toLowerCase();
        return arr.filter((d) => (d.title || "").toLowerCase().includes(k) || (d.file_key || "").toLowerCase().includes(k));
    }, [decks, view, keyword]);

    const tagAndColor = (d: DeckRow) => {
        const { isCopy, isOriginal } = classifyPath(d.file_key);
        if (isCopy) return { label: "복제본", color: "green" as const };
        if (isOriginal) return { label: "원본", color: "blue" as const };
        return { label: d.origin.toUpperCase(), color: "slate" as const };
    };

    const cardBase: React.CSSProperties = {
        borderRadius: 14, background: dark ? "rgba(15,23,42,.92)" : "#fff",
        border: `1px solid ${dark ? "rgba(148,163,184,.18)" : "rgba(148,163,184,.35)"}`,
        padding: 12, display: "flex", flexDirection: "column",
        boxShadow: dark ? "0 6px 18px rgba(2,6,23,.55)" : "0 4px 14px rgba(15,23,42,.08)",
    };
    const Btn = (p: BtnProps) => <button {...p} style={{ ...useBtnStyles(dark, p), ...(p.style || {}) }}>{p.children}</button>;

    // ───────────────────────────────────────────────────────────────────────────────
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

            {/* 업로더 */}
            <div className="panel mb-4" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>자료함으로 업로드</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>PDF를 업로드하면 WebP로 변환되어 자료함에 추가됩니다. (변환 완료 후 자동 갱신)</div>
                <PdfToSlidesUploader onDone={onUploaded} />
            </div>

            {/* 교시 + 필터 */}
            <div className="panel mb-2" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>교시</div>
                <select className="px-2 py-1 border rounded-md text-sm" value={slotSelGlobal} onChange={(e) => setSlotSelGlobal(Number(e.target.value))}>
                    {slots.length ? slots.map((s) => <option key={s} value={s}>{s}교시</option>) : <option value={1}>1교시</option>}
                </select>
                <Btn onClick={async () => {
                    try {
                        const rid = await ensureRoomId();
                        const used = new Set(slots); let next = 1; while (used.has(next) && next <= 12) next++;
                        if (next > 12) { alert("더 이상 교시를 만들 수 없습니다."); return; }
                        const { error } = await supabase.from("room_lessons").upsert({ room_id: rid, slot: next, current_index: 0 }, { onConflict: "room_id,slot" });
                        if (error) throw error;
                        await refreshSlotsList(); setSlotSelGlobal(next);
                    } catch (e: any) { alert(e?.message ?? String(e)); }
                }} small variant="neutral">＋ 새 교시</Btn>

                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <Btn small variant="ghost" pressed={view === "all"} onClick={() => setView("all")}>전체</Btn>
                    <Btn small variant="ghost" pressed={view === "originals"} onClick={() => setView("originals")}>원본</Btn>
                    <Btn small variant="ghost" pressed={view === "copies"} onClick={() => setView("copies")}>복제본</Btn>
                </div>
            </div>

            {/* 검색/액션 */}
            <div className="mb-4" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input className="px-3 py-2 rounded-md border border-slate-300 w-full" placeholder="제목/경로 검색…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <Btn small variant="outline" onClick={() => setKeyword("")}>초기화</Btn>
                <Btn small variant="neutral" onClick={load} disabled={loading}>{loading ? "갱신 중…" : "목록 새로고침"}</Btn>
            </div>

            {error && <div className="text-red-600 mb-2">{error}</div>}

            {/* Grid */}
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", alignItems: "start" }}>
                {filtered.map((d) => {
                    const slot = slotSel[d.id] ?? slotSelGlobal;
                    const tag = tagAndColor(d);
                    const { isCopy, isOriginal } = classifyPath(d.file_key);
                    const actionLabel = isCopy && d.origin === "db" ? "배정하기" : "복제하기";
                    const prefix = slidesPrefixOfAny(d.file_key ?? "") || "";

                    return (
                        <div key={d.id} style={cardBase}>
                            <div className="text-sm font-medium line-clamp-2" style={{ color: dark ? "#e5e7eb" : "#111827" }}>
                                {d.title || "Untitled"}
                            </div>
                            <div className="text-[11px] opacity-60 mb-2">{d.origin === "db" ? "DB" : "Storage"}</div>

                            {prefix ? (
                                <Thumb prefix={prefix} badge={<Chip color={tag.color as any}>{tag.label}</Chip>} />
                            ) : (
                                <div style={{ height: 120, borderRadius: 12, background: dark ? "rgba(2,6,23,.65)" : "#f1f5f9" }} />
                            )}

                            <div className="mt-3 flex items-center gap-8">
                                {prefix && <OpenFirstSlideLink prefix={prefix}>미리보기</OpenFirstSlideLink>}
                                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                    <button className="btn" style={useBtnStyles(dark, { variant: "neutral", small: true })} onClick={() => openEdit(nav, roomCode, d)}>편집</button>
                                    <button className="btn" style={useBtnStyles(dark, { variant: "danger", small: true })} onClick={() => deleteDeck(d)}>삭제</button>
                                </div>
                            </div>

                            {/* 불러오기 (원본은 '복제하기', 복제본(DB) 은 '배정하기') */}
                            <div className="mt-2 flex items-center gap-6">
                                <select className="px-2 py-1 border rounded-md text-sm" value={slot} onChange={(e) => setSlotSel((s) => ({ ...s, [d.id]: Number(e.target.value) }))}>
                                    {(slots.length ? slots : [1,2,3,4,5,6]).map((n) => <option key={n} value={n}>{n}교시</option>)}
                                </select>
                                <button
                                    className="btn"
                                    style={useBtnStyles(dark, { variant: "primary", small: true })}
                                    onClick={() => handleAssign(d, slot)}
                                >
                                    {actionLabel}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 진행 모달 */}
            {assign.open && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 1000 }}>
                    <div style={{ width: 420, borderRadius: 12, background: "#111827", color: "#fff", border: "1px solid rgba(148,163,184,.25)", padding: 16, boxShadow: "0 14px 40px rgba(0,0,0,.6)" }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>자료 불러오는 중</div>
                        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 12 }}>{assign.text}</div>
                        <div style={{ height: 8, background: "rgba(148,163,184,.22)", borderRadius: 999, overflow: "hidden", marginBottom: 10 }}>
                            <div style={{ width: `${assign.progress}%`, height: "100%", background: "#4f46e5", transition: "width .3s ease" }} />
                        </div>
                        <div style={{ maxHeight: 200, overflow: "auto", background: "rgba(2,6,23,.55)", border: "1px solid rgba(148,163,184,.25)", borderRadius: 8, padding: 8, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                            {assign.logs.map((l, i) => (<div key={i}>• {l}</div>))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// helpers bound to UI items
function openEdit(nav: ReturnType<typeof useNavigate>, roomCode: string, d: DeckRow) {
    if (!roomCode) { alert("room 파라미터가 필요합니다."); return; }
    if (!d.file_key) { alert("파일이 없습니다."); return; }
    if (d.origin === "db") nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
    else nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(d.file_key)}`);
}
