// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";

// ───────────────────────────────────────────────────────────────────────────────
// Types
type DeckRow = {
    id: string; // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null; // presentations/* 경로
    file_pages: number | null;
    origin: "db" | "storage"; // DB(decks) vs storage-only(폴더 스캔)
};

// ───────────────────────────────────────────────────────────────────────────────
// Theme helpers
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


async function ensureSlotRow(roomId: string, slot: number) {
    const { error } = await supabase
        .from("room_lessons")
        .upsert({ room_id: roomId, slot, current_index: 0 }, { onConflict: "room_id,slot" });
    if (error) throw error;
}

async function readPagesFromDoneOrList(prefix: string): Promise<number> {
    // prefix 예: rooms/<room>/decks/<deckId>
    // 1) .done.json 우선
    const done = await supabase.storage.from("slides").download(`${prefix}/.done.json`);
    if (!done.error) {
        try {
            const meta = JSON.parse(await done.data.text());
            const pages = Number(meta?.pages);
            if (Number.isFinite(pages) && pages > 0) return pages;
        } catch {}
    }
    // 2) 폴백: .webp 개수 카운트
    const { data, error } = await supabase.storage.from("slides").list(prefix);
    if (!error && data?.length) {
        return data.filter(f => /\.webp$/i.test(f.name)).length;
    }
    return 0;
}

async function copySlidesDir(
    srcPrefix: string,
    destPrefix: string,
    onStep?: (copied: number, total: number) => void,
) {
    // srcPrefix/destPrefix는 'slides' 버킷 기준 경로 (예: 'decks/brain-storming-xxx' → 'rooms/<room>/decks/<deckId>')
    const slides = supabase.storage.from("slides");

    // 1) 소스 목록 재귀 수집
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
                if (!probe.error && (probe.data?.length || 0) > 0) {
                    stack.push(child);
                } else {
                    out.push(child);
                }
            }
        }
        return out;
    }

    const files = await listAll(srcPrefix);
    const total = files.length || 0;
    if (!total) return 0;

    // 2) 파일 복사 (없으면 download→upload 폴백)
    let copied = 0;
    for (const srcPath of files) {
        const rel = srcPath.slice(srcPrefix.length).replace(/^\/+/, ""); // 하위 경로
        const dstPath = `${destPrefix}/${rel}`;

        // try native copy
        const { error: cErr } = await slides.copy(srcPath, dstPath);
        if (cErr) {
            // 폴백: download → upload
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

// (추가) 빠른 슬라이드 복사: .done.json → 정확한 파일명 세트만 복사
async function copySlidesFastByDone(
    slidesPrefixSrc: string,
    slidesPrefixDst: string,
    onStep?: (copied: number, total: number) => void,
) {
    const slides = supabase.storage.from("slides");
    // 1) .done.json 읽기
    const doneKey = `${slidesPrefixSrc}/.done.json`;
    const done = await slides.download(doneKey);
    if (done.error) throw done.error;
    const meta = JSON.parse(await done.data.text()) as { pages: number };
    const total = Math.max(0, Number(meta.pages) || 0);
    if (!total) return 0;

    // 2) 필요한 파일 집합: 0..pages-1 + .done.json
    const targets = Array.from({ length: total }, (_, i) => `${slidesPrefixSrc}/${i}.webp`);
    targets.push(doneKey);

    // 3) 순차 복사 (copy 폴백 download→upload)
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

function useQS() {
    const { search, hash } = useLocation();
    const part = hash.includes("?") ? hash.split("?")[1] : search.replace(/^\?/, "");
    return React.useMemo(() => new URLSearchParams(part), [part]);
}

// ───────────────────────────────────────────────────────────────────────────────
// Small UI
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "neutral" | "outline" | "danger" | "ghost";
    small?: boolean;
    pressed?: boolean; // 토글/세그먼트용
};

const chipPal = {
    blue: { bgD: "rgba(59,130,246,.18)", bgL: "rgba(59,130,246,.12)", bdD: "rgba(59,130,246,.45)", fgD: "#bfdbfe", fgL: "#1e40af" },
    green: { bgD: "rgba(16,185,129,.18)", bgL: "rgba(16,185,129,.12)", bdD: "rgba(16,185,129,.45)", fgD: "#bbf7d0", fgL: "#065f46" },
    slate: { bgD: "rgba(148,163,184,.18)", bgL: "rgba(148,163,184,.12)", bdD: "rgba(148,163,184,.35)", fgD: "#e2e8f0", fgL: "#334155" },
    red: { bgD: "rgba(239,68,68,.22)", bgL: "rgba(239,68,68,.12)", bdD: "rgba(239,68,68,.45)", fgD: "#fecaca", fgL: "#7f1d1d" },
} as const;

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
            border: `1px solid rgba(239,68,68,.45)`,
        },
        ghost: {
            background: pressed ? (dark ? "rgba(99,102,241,.18)" : "rgba(99,102,241,.12)") : "transparent",
            color: dark ? "#e5e7eb" : "#111827",
            border: `1px solid ${pressed ? "rgba(99,102,241,.35)" : "transparent"}`,
        },
    } as const;
    return { ...base, ...set[variant] };
}

function Chip({ color, children }: { color: "blue" | "green" | "slate" | "red"; children: React.ReactNode }) {
    const dark = usePrefersDark();
    const pal = chipPal[color];
    return (
        <span
            style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 999,
                background: dark ? pal.bgD : pal.bgL,
                color: dark ? pal.fgD : pal.fgL,
                border: `1px solid ${dark ? pal.bdD : pal.bdD}`,
            }}
        >
      {children}
    </span>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// Signed URL helpers (링크/썸네일)
function OpenSignedLink({ fileKey, children }: { fileKey: string; children: React.ReactNode }) {
    const [href, setHref] = React.useState("#");
    const dark = usePrefersDark();
    const style = useBtnStyles(dark, { variant: "outline", small: true });

    React.useEffect(() => {
        let off = false;
        (async () => {
            const { data } = await supabase.storage.from("presentations").createSignedUrl(fileKey, 3600 * 24 * 7);
            if (!off && data?.signedUrl) {
                setHref(data.signedUrl);
                return;
            }
            const { data: pub } = supabase.storage.from("presentations").getPublicUrl(fileKey);
            if (!off) setHref(pub.publicUrl || "#");
        })();
        return () => {
            off = true;
        };
    }, [fileKey]);

    return (
        <a style={style} href={href} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}

function useReadableUrl(key: string | null | undefined, ttlSec = 3600 * 24) {
    const [url, setUrl] = React.useState<string>("");
    React.useEffect(() => {
        let off = false;
        (async () => {
            if (!key) {
                setUrl("");
                return;
            }
            const { data } = await supabase.storage.from("presentations").createSignedUrl(key, ttlSec);
            if (!off && data?.signedUrl) {
                setUrl(`${data.signedUrl}`);
                return;
            }
            const { data: pub } = supabase.storage.from("presentations").getPublicUrl(key);
            if (!off) setUrl(pub.publicUrl || "");
        })();
        return () => {
            off = true;
        };
    }, [key, ttlSec]);
    return url;
}

// 교체 전: function Thumb({ keyStr, badge }) { ...PdfViewer... }
// 교체 후:
function Thumb({ keyStr, badge }: { keyStr: string; badge: React.ReactNode }) {
    const dark = usePrefersDark();
    const [useSlidesImg, setUseSlidesImg] = React.useState(true);

    // fileKey -> slides의 썸네일(0.webp) 경로 추론
    const folder = folderPrefixOfFileKey(keyStr); // e.g. 'decks/<slug>' or 'rooms/<room>/decks/<deckId>'
    const slidesKey = folder ? `${folder}/0.webp` : null;
    const slidesUrl = slidesKey
        ? supabase.storage.from("slides").getPublicUrl(slidesKey).data.publicUrl
        : null;

    // PDF 프리뷰 URL (폴백)
    const pdfUrl = useReadableUrl(keyStr);

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
            {useSlidesImg && slidesUrl ? (
                <img
                    src={slidesUrl}
                    style={{ maxHeight: 120, width: "100%", objectFit: "contain" }}
                    alt="slide thumb"
                    onError={() => setUseSlidesImg(false)} // 없으면 PDF 프리뷰로 폴백
                />
            ) : pdfUrl ? (
                <PdfViewer fileUrl={pdfUrl} page={1} maxHeight="120px" />
            ) : (
                <div style={{ width: "100%", display: "grid", placeItems: "center", maxHeight: 120 }}>
                    <div style={{ fontSize: 12, opacity: 0.7, padding: 8, color: dark ? "#cbd5e1" : "#475569" }}>
                        파일을 불러올 수 없습니다.
                    </div>
                </div>
            )}
            <div style={{ position: "absolute", top: 6, left: 6 }}>{badge}</div>
        </div>
    );
}


// ───────────────────────────────────────────────────────────────────────────────
// Storage helpers (삭제/스캔)
async function listDir(bucket: string, prefix: string) {
    return await supabase.storage
        .from(bucket)
        .list(prefix, { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
}

/** "decks/slug/.." 또는 "rooms/<room>/decks/<deckId>/.." → 상위 폴더 경로 */
function folderPrefixOfFileKey(fileKey: string | null | undefined) {
    if (!fileKey) return null;
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
            const child = `${cur}/${ent.name}`;
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
    try {
        await b.remove([root]);
    } catch {}
}

// ───────────────────────────────────────────────────────────────────────────────
// Orphan detection & cleaning
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000; // 하루

function shouldAutoCleanOncePerDay() {
    const last = Number(localStorage.getItem("orphanCleanLast") || 0);
    return Date.now() - last > ORPHAN_TTL_MS;
}
function markAutoCleanRun() {
    localStorage.setItem("orphanCleanLast", String(Date.now()));
}

function useOrphanStates() {
    const [missing, setMissing] = React.useState<DeckRow[]>([]);
    const [autoClean, setAutoClean] = React.useState<boolean>(() => {
        const v = localStorage.getItem("autoCleanOrphan");
        return v === "1";
    });
    React.useEffect(() => {
        localStorage.setItem("autoCleanOrphan", autoClean ? "1" : "0");
    }, [autoClean]);
    return { missing, setMissing, autoClean, setAutoClean };
}

/** 폴더 단위로 list를 묶어 호출 → 존재 여부 판별(비용↓) */
async function findMissingByFolder(rows: DeckRow[]) {
    const byPrefix = new Map<string, { names: Set<string>; rows: DeckRow[] }>();

    for (const r of rows) {
        if (!r.file_key) continue;
        const prefix = folderPrefixOfFileKey(r.file_key);
        if (!prefix) continue;
        const name = r.file_key.split("/").pop()!;
        const bucket = byPrefix.get(prefix) ?? { names: new Set(), rows: [] };
        bucket.rows.push(r);
        byPrefix.set(prefix, bucket);
    }

    await Promise.all(
        Array.from(byPrefix.keys()).map(async (prefix) => {
            const { data } = await supabase.storage.from("presentations").list(prefix);
            const names = new Set((data || []).map((e) => e.name));
            byPrefix.get(prefix)!.names = names;
        }),
    );

    const missing: DeckRow[] = [];
    for (const [, bucket] of byPrefix) {
        for (const r of bucket.rows) {
            const name = r.file_key!.split("/").pop()!;
            if (!bucket.names.has(name)) missing.push(r);
        }
    }
    return missing;
}

async function detachMissingFileKeys(rows: DeckRow[]) {
    const targets = rows.filter((r) => r.origin !== "storage" && r.file_key).map((r) => r.id);
    if (!targets.length) return;
    await supabase.from("decks").update({ file_key: null, file_pages: null }).in("id", targets);
}

// ───────────────────────────────────────────────────────────────────────────────
// 변환 진행 폴링 (현재 미사용; 필요 시 사용)
async function pollSlidesProgress(
    roomId: string,
    deckId: string,
    expectedPages?: number,
    onTick?: (pct: number, count: number) => void,
    timeoutMs = 120000,
) {
    const start = Date.now();
    const prefix = `rooms/${roomId}/decks/${deckId}`;
    let count = 0;
    while (Date.now() - start < timeoutMs) {
        const { data } = await supabase.storage.from("slides").list(prefix);
        count = data?.length || 0;
        const pct = expectedPages ? Math.min(99, Math.floor((count / expectedPages) * 100)) : count > 0 ? 100 : 5;
        onTick?.(pct, count);
        if (expectedPages ? count >= expectedPages : count > 0) return count;
        await new Promise((r) => setTimeout(r, 1200));
    }
    return count; // timeout
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
export default function PdfLibraryPage() {
    const nav = useNavigate();
    const qs = useQS();
    const roomCode = qs.get("room") || "";
    const dark = usePrefersDark();

    // 진행 모달 (로그 포함) — 중복 선언 제거됨
    const [assign, setAssign] = React.useState<{
        open: boolean;
        progress: number;
        text: string;
        deckId: string | null;
        logs: string[];
    }>({ open: false, progress: 0, text: "", deckId: null, logs: [] });

    const logAssign = React.useCallback((m: string) => {
        setAssign((a) => ({ ...a, logs: [...a.logs, m].slice(-300) }));
    }, []);

    // UI state
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [decks, setDecks] = React.useState<DeckRow[]>([]);
    const [keyword, setKeyword] = React.useState("");
    const [view, setView] = React.useState<"all" | "pdf" | "copies">("all");
    const [slotSelGlobal, setSlotSelGlobal] = React.useState<number>(1);
    const [slotSel, setSlotSel] = React.useState<Record<string, number>>({});
    const { missing, setMissing, autoClean, setAutoClean } = useOrphanStates();

    // room & slots
    const [roomId, setRoomId] = React.useState<string | null>(null);
    const [slots, setSlots] = React.useState<number[]>([]);

    // room/slot helpers
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
            const { data, error } = await supabase.from("room_lessons").select("slot").eq("room_id", rid).order("slot", { ascending: true });
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
            let next = 1;
            while (used.has(next) && next <= 12) next++;
            if (next > 12) {
                alert("더 이상 교시를 만들 수 없습니다.");
                return;
            }
            const { error } = await supabase
                .from("room_lessons")
                .upsert({ room_id: rid, slot: next, current_index: 0 }, { onConflict: "room_id,slot" });
            if (error) throw error;
            await refreshSlotsList();
            setSlotSelGlobal(next);
        } catch (e: any) {
            alert(e?.message ?? String(e));
        }
    }, [ensureRoomId, slots, refreshSlotsList]);

    React.useEffect(() => {
        if (roomCode) ensureRoomId().then(refreshSlotsList);
        // eslint-disable-next-line
    }, [roomCode]);

    // 목록: Storage 스캔
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
            const pick = files.find((f) => /slides-.*\.pdf$/i.test(f.name)) || files.find((f) => /\.pdf$/i.test(f.name));
            if (!pick) continue;
            const file_key = `${path}/${pick.name}`;
            rows.push({ id: `s:${file_key}`, title: folder, file_key, file_pages: null, origin: "storage" });
            if (rows.length >= 200) break;
        }
        return rows;
    }, []);

    // 목록: DB + Storage 병합 → 유실 파일 감지/필터/자동 정리(옵션)
    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let merged: DeckRow[] = [];

            // DB 우선
            try {
                const { data, error } = await supabase.rpc("list_library_decks", { p_limit: 200 });
                if (error) throw error;
                merged = (data || []).map((d: any) => ({
                    id: d.id,
                    title: d.title ?? null,
                    file_key: d.file_key ?? null,
                    file_pages: d.file_pages ?? null,
                    origin: "db" as const,
                }));
            } catch {
                const { data, error } = await supabase.from("decks").select("id,title,file_key,file_pages").limit(200);
                if (!error) {
                    merged = (data || []).map((d: any) => ({
                        id: d.id,
                        title: d.title ?? null,
                        file_key: d.file_key ?? null,
                        file_pages: d.file_pages ?? null,
                        origin: "db" as const,
                    }));
                }
            }

            // Storage 병합
            try {
                const sRows = await fetchFromStorage(120);
                const byKey = new Map<string, DeckRow>();
                for (const r of merged) if (r.file_key) byKey.set(r.file_key, r);
                for (const r of sRows) if (r.file_key && !byKey.has(r.file_key)) byKey.set(r.file_key, r);
                merged = Array.from(byKey.values());
            } catch {}

            // 유실 파일 감지
            const missingRows = await findMissingByFolder(merged);
            setMissing(missingRows);

            // 화면에는 존재하는 것만 표시
            const missingIds = new Set(missingRows.map((m) => m.id));
            const visible = merged.filter((r) => !r.file_key || !missingIds.has(r.id));
            setDecks(visible);

            // 하루 1회 자동 정리(옵션)
            if (autoClean && missingRows.length && shouldAutoCleanOncePerDay()) {
                await detachMissingFileKeys(missingRows);
                markAutoCleanRun();
                await load();
                return;
            }

            if (merged.length === 0) setError("표시할 자료가 없습니다. (DB/RPC 또는 스토리지에 자료 없음)");
        } catch (e: any) {
            setError(e?.message || "목록을 불러오지 못했어요.");
        } finally {
            setLoading(false);
        }
    }, [fetchFromStorage, autoClean, setMissing]);

    React.useEffect(() => {
        load();
    }, [load]);

    // 업로드 완료 → 새로고침
    const onUploaded = React.useCallback(() => {
        load();
    }, [load]);

    // ── 불러오기: 사본 생성 → 슬라이드 복사(변환 없음) → 배정 확인 ──
    // 기존 createDeckFromFileKeyAndAssign(...) 전체를 다음으로 교체
    async function createDeckFromFileKeyAndAssign(
        fileKey: string,
        roomId: string,
        slot: number,
        title?: string | null
    ) {
        // (0) 교시 row 보장
        await ensureSlotRow(roomId, slot);

        // (A) decks 생성
        const ins = await supabase.from("decks").insert({ title: title ?? "Imported" }).select("id").single();
        if (ins.error) throw ins.error;
        const newDeckId = ins.data.id as string;
        logAssign(`덱 생성: ${newDeckId}`);

        // (B) PDF 사본 (presentations)
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
            const up = await supabase.storage
                .from("presentations")
                .upload(destKey, dl.data, { contentType: "application/pdf", upsert: true });
            if (up.error) throw up.error;
        }
        logAssign(`PDF 사본: presentations/${destKey}`);

        // (C) decks.file_key 업데이트
        const upDeck = await supabase.from("decks").update({ file_key: destKey }).eq("id", newDeckId);
        if (upDeck.error) throw upDeck.error;

        // (D) slides 복사 (FAST → Fallback)
        const srcSlidesPrefix = folderPrefixOfFileKey(fileKey);
        const dstSlidesPrefix = `rooms/${roomId}/decks/${newDeckId}`;
        if (srcSlidesPrefix) {
            try {
                logAssign(`슬라이드 복사 준비(.done.json 확인)…`);
                await copySlidesFastByDone(srcSlidesPrefix, dstSlidesPrefix, (copied, total) => {
                    const pct = Math.max(12, Math.min(98, Math.floor(12 + (copied / Math.max(1, total)) * 85)));
                    setAssign(a => ({ ...a, progress: pct, text: `슬라이드 복사 중… ${copied}/${total}` }));
                });
                logAssign(`슬라이드 복사 완료(FAST): slides/${dstSlidesPrefix}`);
            } catch {
                logAssign(`FAST 복사 실패 → 재귀 복사 진행`);
                await copySlidesDir(srcSlidesPrefix, dstSlidesPrefix, (copied, total) => {
                    const pct = Math.max(12, Math.min(98, Math.floor(12 + (copied / Math.max(1, total)) * 85)));
                    setAssign(a => ({ ...a, progress: pct, text: `슬라이드 복사 중… ${copied}/${total}` }));
                });
                logAssign(`슬라이드 복사 완료(FALLBACK): slides/${dstSlidesPrefix}`);
            }
        } else {
            logAssign(`슬라이드 원본 없음 → 복사 생략`);
        }

        // (E) 페이지 수 기록 (매니페스트 확장을 위해 중요)
        try {
            const pages = await readPagesFromDoneOrList(dstSlidesPrefix);
            if (pages > 0) {
                await supabase.from("decks").update({ file_pages: pages }).eq("id", newDeckId).throwOnError();
                logAssign(`decks.file_pages = ${pages} 갱신`);
            } else {
                logAssign(`경고: 페이지 수를 확인하지 못했습니다`);
            }
        } catch (e:any) {
            logAssign(`페이지 수 갱신 실패: ${e?.message || e}`);
        }

        // (F) room_decks 배정(upsert) + 검증
        const upMap = await supabase
            .from("room_decks")
            .upsert({ room_id: roomId, slot, deck_id: newDeckId }, { onConflict: "room_id,slot" })
            .select("deck_id,slot")
            .single();
        if (upMap.error) throw upMap.error;
        logAssign(`배정 완료: slot=${slot}, deck=${newDeckId}`);

        const check = await supabase.from("room_decks").select("deck_id").eq("room_id", roomId).eq("slot", slot).maybeSingle();
        if (!check.data?.deck_id) throw new Error("배정 검증 실패(조회 결과 없음)");
        logAssign(`배정 검증 통과`);

        return { newDeckId, destKey, srcSlidesPrefix, dstSlidesPrefix };
    }


    async function assignDeckToSlot(d: DeckRow, slot: number) {
        if (!roomCode) {
            alert("room 파라미터가 필요합니다.");
            return;
        }
        if (!d.file_key) {
            alert("파일이 없습니다.");
            return;
        }

        try {
            const rid = await ensureRoomId();

            // 단계 1: PDF 사본
            setAssign({ open: true, progress: 5, text: "사본(PDF) 생성 중…", deckId: null, logs: [] });
            logAssign(`시작: room=${rid}, slot=${slot}, file=${d.file_key}`);

            const { newDeckId } = await createDeckFromFileKeyAndAssign(d.file_key, rid, slot, d.title);

            // UI 업데이트
            setAssign((a) => ({ ...a, deckId: newDeckId }));

            // 완료 & 새로고침
            setAssign((a) => ({ ...a, progress: 100, text: "완료! 목록을 갱신합니다…" }));
            await load();
            setTimeout(() => setAssign({ open: false, progress: 0, text: "", deckId: null, logs: [] }), 600);
        } catch (e: any) {
            console.error(e);
            logAssign(`에러: ${e?.message || e}`);
            setAssign((a) => ({ ...a, text: `에러: ${e?.message || e}` }));
            alert(`불러오기 실패: ${e?.message || e}`);
            setAssign({ open: false, progress: 0, text: "", deckId: null, logs: [] });
        }
    }

    // 삭제(정리)
    const deleteDeck = React.useCallback(
        async (d: DeckRow) => {
            // 낙관적 제거
            setDecks((prev) => prev.filter((x) => x.id !== d.id));

            try {
                const bucket = "presentations";
                const prefix = d.file_key ? folderPrefixOfFileKey(d.file_key) : null;

                if (d.origin === "db") {
                    // DB 연결 해제/삭제
                    try {
                        const { error } = await supabase.rpc("delete_deck_deep", { p_deck_id: d.id });
                        if (error) throw error;
                    } catch {
                        await supabase.from("room_decks").delete().eq("deck_id", d.id);
                        const del = await supabase.from("decks").delete().eq("id", d.id);
                        if (del.error) throw del.error;
                    }
                    // 스토리지 정리
                    if (prefix) await removeTree(bucket, prefix);
                } else {
                    // storage only
                    if (!prefix) throw new Error("file_key 없음");
                    await removeTree(bucket, prefix);
                }

                // 안전망
                if (prefix) {
                    const ls = await supabase.storage.from(bucket).list(prefix);
                    if (!ls.error && (ls.data?.length || 0) > 0) {
                        await removeTree(bucket, prefix);
                    }
                }
            } catch (e: any) {
                await load();
                alert(e?.message ?? String(e));
                return;
            }

            await load();
        },
        [load],
    );

    // 필터/검색
    const filtered = React.useMemo(() => {
        let arr = decks;
        if (view !== "all") {
            arr = arr.filter((d) => {
                const isPdf = (d.file_key || "").includes("/decks/");
                return view === "pdf" ? isPdf : !isPdf;
            });
        }
        if (!keyword.trim()) return arr;
        const k = keyword.trim().toLowerCase();
        return arr.filter(
            (d) => (d.title || "").toLowerCase().includes(k) || (d.file_key || "").toLowerCase().includes(k),
        );
    }, [decks, view, keyword]);

    const tagAndColor = (d: DeckRow) => {
        const key = d.file_key || "";
        if (key.includes("/decks/")) return { label: "원본 PDF", color: "blue" as const };
        if (key.includes("/rooms/")) return { label: "복제본", color: "green" as const };
        return { label: d.origin.toUpperCase(), color: "slate" as const };
    };

    const cardBase: React.CSSProperties = {
        borderRadius: 14,
        background: dark ? "rgba(15,23,42,.92)" : "#fff",
        border: `1px solid ${dark ? "rgba(148,163,184,.18)" : "rgba(148,163,184,.35)"}`,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: dark ? "0 6px 18px rgba(2,6,23,.55)" : "0 4px 14px rgba(15,23,42,.08)",
    };
    const Btn = (p: BtnProps) => (
        <button {...p} style={{ ...useBtnStyles(dark, p), ...(p.style || {}) }}>
            {p.children}
        </button>
    );

    return (
        <div className="px-4 py-4 max-w-7xl mx-auto">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Btn variant="outline" onClick={() => nav(`/teacher?room=${encodeURIComponent(roomCode)}&mode=setup`)} small>
                        ← 뒤로
                    </Btn>
                    <h1 className="text-xl font-semibold">자료함</h1>
                </div>
                <div className="text-sm opacity-70">
                    room: <code>{roomCode || "(미지정)"}</code>
                </div>
            </div>

            {/* 업로더 */}
            <div className="panel mb-4" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>자료함으로 업로드</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>PDF를 업로드하면 변환되어 자료함에 추가됩니다. (변환 완료 후 자동 갱신)</div>
                <PdfToSlidesUploader onFinished={onUploaded} />
            </div>

            {/* 교시 + 필터 */}
            <div
                className="panel mb-2"
                style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
                <div style={{ fontWeight: 700 }}>교시</div>
                <select
                    className="px-2 py-1 border rounded-md text-sm"
                    value={slotSelGlobal}
                    onChange={(e) => setSlotSelGlobal(Number(e.target.value))}
                >
                    {slots.length ? (
                        slots.map((s) => (
                            <option key={s} value={s}>
                                {s}교시
                            </option>
                        ))
                    ) : (
                        <option value={1}>1교시</option>
                    )}
                </select>
                <Btn onClick={createSlot} small variant="neutral">
                    ＋ 새 교시
                </Btn>

                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <Btn small variant="ghost" pressed={view === "all"} onClick={() => setView("all")}>
                        전체
                    </Btn>
                    <Btn small variant="ghost" pressed={view === "pdf"} onClick={() => setView("pdf")}>
                        원본 PDF
                    </Btn>
                    <Btn small variant="ghost" pressed={view === "copies"} onClick={() => setView("copies")}>
                        복제본
                    </Btn>
                </div>
            </div>

            {/* 자동 정리 토글 + DB 정리 버튼 */}
            <div className="mb-4" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.9 }}>
                    <input type="checkbox" checked={autoClean} onChange={(e) => setAutoClean(e.target.checked)} />
                    하루 1회 자동 정리
                </label>

                {missing.length > 0 && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, opacity: 0.85 }}>유실 파일 {missing.length}건 감지됨</span>
                        <Btn
                            className="btn btn-outline btn-sm"
                            variant="outline"
                            small
                            onClick={async () => {
                                await detachMissingFileKeys(missing);
                                await load();
                            }}
                            disabled={loading}
                        >
                            DB 정리
                        </Btn>
                    </div>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <Btn small variant="outline" onClick={() => setKeyword("")}>
                        검색 초기화
                    </Btn>
                    <Btn small variant="neutral" onClick={load} disabled={loading}>
                        {loading ? "갱신 중…" : "목록 새로고침"}
                    </Btn>
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

                            {d.file_key ? (
                                <Thumb keyStr={d.file_key} badge={<Chip color={tag.color as any}>{tag.label}</Chip>} />
                            ) : (
                                <div style={{ height: 120, borderRadius: 12, background: dark ? "rgba(2,6,23,.65)" : "#f1f5f9" }} />
                            )}

                            <div className="mt-3 flex items-center gap-8">
                                {d.file_key && <OpenSignedLink fileKey={d.file_key}>링크 열기</OpenSignedLink>}
                                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                    <Btn small variant="neutral" onClick={() => openEdit(nav, roomCode, d)}>
                                        편집
                                    </Btn>
                                    <Btn small variant="danger" onClick={() => deleteDeck(d)}>
                                        삭제
                                    </Btn>
                                </div>
                            </div>

                            {/* 불러오기(교시 지정) */}
                            <div className="mt-2 flex items-center gap-6">
                                <select
                                    className="px-2 py-1 border rounded-md text-sm"
                                    value={slot}
                                    onChange={(e) => setSlotSel((s) => ({ ...s, [d.id]: Number(e.target.value) }))}
                                >
                                    {(slots.length ? slots : [1, 2, 3, 4, 5, 6]).map((n) => (
                                        <option key={n} value={n}>
                                            {n}교시
                                        </option>
                                    ))}
                                </select>
                                <Btn small variant="primary" onClick={() => assignDeckToSlot(d, slot)}>
                                    지금 불러오기
                                </Btn>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 진행 모달 */}
            {assign.open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,.45)",
                        display: "grid",
                        placeItems: "center",
                        zIndex: 1000,
                    }}
                >
                    <div
                        style={{
                            width: 420,
                            borderRadius: 12,
                            background: "#111827",
                            color: "#fff",
                            border: "1px solid rgba(148,163,184,.25)",
                            padding: 16,
                            boxShadow: "0 14px 40px rgba(0,0,0,.6)",
                        }}
                    >
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>자료 불러오는 중</div>
                        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 12 }}>{assign.text}</div>
                        <div
                            style={{
                                height: 8,
                                background: "rgba(148,163,184,.22)",
                                borderRadius: 999,
                                overflow: "hidden",
                                marginBottom: 10,
                            }}
                        >
                            <div
                                style={{
                                    width: `${assign.progress}%`,
                                    height: "100%",
                                    background: "#4f46e5",
                                    transition: "width .3s ease",
                                }}
                            />
                        </div>
                        <div
                            style={{
                                maxHeight: 200,
                                overflow: "auto",
                                background: "rgba(2,6,23,.55)",
                                border: "1px solid rgba(148,163,184,.25)",
                                borderRadius: 8,
                                padding: 8,
                                fontSize: 12,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                            }}
                        >
                            {assign.logs.map((l, i) => (
                                <div key={i}>• {l}</div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────────
// helpers bound to UI items
function openEdit(nav: ReturnType<typeof useNavigate>, roomCode: string, d: DeckRow) {
    if (!roomCode) {
        alert("room 파라미터가 필요합니다.");
        return;
    }
    if (!d.file_key) {
        alert("파일이 없습니다.");
        return;
    }
    if (d.origin === "db") nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(d.id)}`);
    else nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(d.file_key)}`);
}
