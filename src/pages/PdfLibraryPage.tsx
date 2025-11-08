// src/pages/PdfLibraryPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import PdfViewer from "../components/PdfViewer";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";

/** ─────────────────────────────────────────────────────────────────────────────
 *  Types
 *  ───────────────────────────────────────────────────────────────────────────*/
type DeckRow = {
    id: string;                // DB 덱이면 uuid, 스토리지 항목이면 "s:<file_key>"
    title: string | null;
    file_key: string | null;   // presentations/* 경로
    file_pages: number | null;
    origin: "db" | "storage";  // DB(decks) vs storage-only(폴더 스캔)
};

type AssignState = {
    open: boolean;
    progress: number;
    text: string;
    lines: string[];
    deckId?: string | null;
};

/** ─────────────────────────────────────────────────────────────────────────────
 *  Small utils
 *  ───────────────────────────────────────────────────────────────────────────*/
function pushLog(setter: React.Dispatch<React.SetStateAction<AssignState>>, msg: string) {
    setter(s => ({ ...s, lines: [...s.lines, msg] }));
}

function sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}

/** presentations/* 파일키 → slides 버킷의 폴더 prefix 로 변환
 *  presentations/decks/<slug>/slides-*.pdf   → decks/<slug>
 *  presentations/rooms/<room>/decks/<id>/…   → rooms/<room>/decks/<id>
 */
function slidesPrefixOfPresentationsFile(fileKey: string | null | undefined): string | null {
    if (!fileKey) return null;
    const m1 = fileKey.match(/^decks\/([^/]+)/); // 이미 presentations/ 제거된 상태를 기대하지 않음
    // 실제 저장소는 presentations 버킷이므로 앞에 presentations/가 붙어온다.
    const key = fileKey.replace(/^\/+|^presentations\//, "");
    if (key.startsWith("decks/")) {
        const slug = key.split("/")[1];
        return `decks/${slug}`;
    }
    // rooms/<room>/decks/<uuid>/slides-*.pdf
    const m = key.match(/^rooms\/([^/]+)\/decks\/([0-9a-f-]{36})\//);
    if (m) return `rooms/${m[1]}/decks/${m[2]}`;
    return null;
}

/** presentations/rooms/<room>/decks/<uuid>/… 에서 deckId 추출 */
function parseDeckIdFromRoomsKey(fileKey: string | null | undefined): string | null {
    if (!fileKey) return null;
    const key = fileKey.replace(/^\/+|^presentations\//, "");
    const m = key.match(/^rooms\/([^/]+)\/decks\/([0-9a-f-]{36})\//);
    return m ? m[2] : null;
}

/** rooms/* 키가 현재 room 에 속하는지 검사 */
function isRoomsKeyForRoom(fileKey: string | null | undefined, roomId: string): boolean {
    if (!fileKey) return false;
    const key = fileKey.replace(/^\/+|^presentations\//, "");
    return key.startsWith(`rooms/${roomId}/decks/`);
}

/** 파일키에서 폴더 prefix만 추출 (presentations/* 기준) */
function folderPrefixOfFileKey(fileKey: string | null | undefined): string | null {
    if (!fileKey) return null;
    const key = fileKey.replace(/^\/+/, "");
    const parts = key.split("/");
    if (parts.length < 2) return null;
    return parts.slice(0, 2).join("/"); // e.g., decks/<slug> or rooms/<room>
}

/** slides/<prefix> 에서 페이지수 읽기 (.done.json 우선) */
async function readPagesFromSlidesPrefix(prefix: string): Promise<number> {
    const slides = supabase.storage.from("slides");
    // 1) done marker
    const done = await slides.download(`${prefix}/.done.json`);
    if (!done.error && done.data) {
        try {
            const txt = await done.data.text();
            const obj = JSON.parse(txt);
            const n = Number(obj?.pages ?? obj?.total ?? 0);
            if (Number.isFinite(n) && n > 0) return n;
        } catch { /* noop */ }
    }
    // 2) count *.webp
    const ls = await slides.list(prefix);
    if (ls.error) return 0;
    const pages = (ls.data ?? []).filter(x => /\.webp$/i.test(x.name)).length;
    return pages;
}

/** slides 폴더 전체 복사 (하위 폴더 없이 평면 구조 가정) */
async function copySlidesDir(
    srcPrefix: string,
    destPrefix: string,
    onStep?: (copied: number, total: number) => void
) {
    const slides = supabase.storage.from("slides");
    const list = await slides.list(srcPrefix);
    if (list.error) throw list.error;
    const items = (list.data ?? []).map(x => `${srcPrefix}/${x.name}`);
    const total = items.length;
    let copied = 0;
    for (const path of items) {
        const name = path.split("/").pop()!;
        const dl = await slides.download(path);
        if (dl.error) throw dl.error;
        const up = await slides.upload(`${destPrefix}/${name}`, dl.data, { upsert: true, contentType: name.endsWith(".json") ? "application/json" : "image/webp" });
        if (up.error) throw up.error;
        copied++;
        onStep?.(copied, total);
        if (total > 20) await sleep(5); // UI 반영용 작은 딜레이
    }
}

/** ─────────────────────────────────────────────────────────────────────────────
 *  Page
 *  ───────────────────────────────────────────────────────────────────────────*/
export default function PdfLibraryPage() {
    const nav = useNavigate();
    const qs = new URLSearchParams(useLocation().search);
    const roomCode = qs.get("room") ?? "";
    const [roomId, setRoomId] = React.useState<string | null>(null);

    // UI 상태
    const [rows, setRows] = React.useState<DeckRow[]>([]);
    const [slotSel, setSlotSel] = React.useState<number>(1);
    const [assign, setAssign] = React.useState<AssignState>({ open: false, progress: 0, text: "", lines: [] });

    React.useEffect(() => {
        (async () => {
            if (!roomCode) return;
            // room id 확보
            const { data, error } = await supabase.rpc("claim_room_auth", { p_room_code: roomCode });
            if (error) { console.error(error); return; }
            setRoomId(data?.id ?? null);
            await refreshList();
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCode]);

    /** 목록 새로고침 (DB decks + storage 스캔 병합) */
    const refreshList = React.useCallback(async () => {
        const out: DeckRow[] = [];

        // 1) DB decks
        const q = await supabase.from("decks").select("id,title,file_key,file_pages").order("updated_at", { ascending: false }).limit(100);
        if (!q.error) {
            for (const d of q.data ?? []) {
                out.push({
                    id: d.id,
                    title: d.title,
                    file_key: d.file_key,
                    file_pages: d.file_pages,
                    origin: "db",
                });
            }
        }

        // 2) storage 원본 스캔 (presentations/decks/*/slides-*.pdf)
        const pres = supabase.storage.from("presentations");
        const ls = await pres.list("decks");
        if (!ls.error) {
            for (const dir of ls.data ?? []) {
                if (!dir.name) continue;
                const slug = dir.name;
                const files = await pres.list(`decks/${slug}`);
                const pdf = (files.data ?? []).find(f => /^slides-.*\.pdf$/i.test(f.name));
                if (pdf) {
                    out.push({
                        id: `s:decks/${slug}/${pdf.name}`,
                        title: slug,
                        file_key: `decks/${slug}/${pdf.name}`,
                        file_pages: null,
                        origin: "storage",
                    });
                }
            }
        }

        setRows(out);
    }, []);

    /** 배지 라벨 */
    function badgeOf(r: DeckRow): "원본" | "원본 PDF" | "복제본" | "DB" {
        if (r.origin === "storage") return "원본 PDF";
        if (r.file_key?.startsWith("presentations/rooms") || r.file_key?.startsWith("rooms/")) return "복제본";
        return "DB";
    }

    /** 현재 room 의 slot 에 deck 배정 (원본이면 사본 생성, 복제본이면 그대로 배정) */
    const assignDeckToSlot = React.useCallback(async (r: DeckRow, slot: number) => {
        if (!roomId) { alert("room 이 없습니다."); return; }

        setAssign({ open: true, progress: 2, text: "시작합니다…", lines: [] });

        try {
            // 0) 복제본이면 그대로 배정 (copy-of-copy 방지)
            if (r.origin === "db" && r.file_key && isRoomsKeyForRoom(r.file_key, roomId)) {
                const deckId = parseDeckIdFromRoomsKey(r.file_key)!;
                pushLog(setAssign, `복제본 감지 → 사본 생성 생략 (deck: ${deckId})`);
                setAssign(s => ({ ...s, progress: 10, text: "기존 덱 배정 중…" }));

                // file_pages 보정
                const srcSlides = slidesPrefixOfPresentationsFile(r.file_key);
                if (srcSlides) {
                    const pages = await readPagesFromSlidesPrefix(srcSlides);
                    if (pages > 0) {
                        await supabase.from("decks").update({ file_pages: pages }).eq("id", deckId);
                        pushLog(setAssign, `페이지 수 동기화: ${pages}`);
                    }
                }

                const up = await supabase.from("room_decks")
                    .upsert({ room_id: roomId, slot, deck_id: deckId }, { onConflict: "room_id,slot" });
                if (up.error) throw up.error;

                setAssign(s => ({ ...s, progress: 100, text: "배정 완료" }));
                await sleep(250);
                setAssign(s => ({ ...s, open: false }));
                return;
            }

            // 1) 원본 → 덱 생성 + 프레젠테이션 사본 + 슬라이드 복사
            if (!r.file_key) throw new Error("file_key 없음");
            const fileKey = r.file_key.startsWith("presentations/") ? r.file_key.replace(/^presentations\//, "") : r.file_key;

            // (A) decks 생성
            setAssign(s => ({ ...s, text: "덱 생성 중…", progress: 5 }));
            const ins = await supabase.from("decks").insert({ title: r.title ?? "Imported" }).select("id").single();
            if (ins.error) throw ins.error;
            const newDeckId = ins.data.id as string;
            pushLog(setAssign, `decks 생성: ${newDeckId}`);

            // (B) PDF 사본 저장 (presentations/rooms/<room>/decks/<id>/slides-*.pdf)
            const ts = Date.now();
            const destPdfKey = `rooms/${roomId}/decks/${newDeckId}/slides-${ts}.pdf`;
            setAssign(s => ({ ...s, text: "PDF 사본 복사 중…", progress: 8 }));
            const pres = supabase.storage.from("presentations");
            // 서버내 copy API 우선
            const cp = await pres.copy(fileKey, destPdfKey);
            if (cp.error) {
                const dl = await pres.download(fileKey);
                if (dl.error) throw dl.error;
                const up = await pres.upload(destPdfKey, dl.data, { upsert: true, contentType: "application/pdf" });
                if (up.error) throw up.error;
            }
            await supabase.from("decks").update({ file_key: destPdfKey }).eq("id", newDeckId);

            // (C) slides 복사
            const srcSlides = slidesPrefixOfPresentationsFile(fileKey)!;     // e.g., decks/<slug>
            const dstSlides = `rooms/${roomId}/decks/${newDeckId}`;
            setAssign(s => ({ ...s, text: "슬라이드 이미지 복사 준비…", progress: 12 }));
            let last = 12;
            await copySlidesDir(srcSlides, dstSlides, (copied, total) => {
                const pct = Math.max(12, Math.min(96, Math.floor(12 + (copied / Math.max(1, total)) * 80)));
                if (pct > last) {
                    last = pct;
                    setAssign(s => ({ ...s, progress: pct, text: `슬라이드 복사 중… ${pct}%` }));
                }
            });
            pushLog(setAssign, `슬라이드 복사 완료: ${srcSlides} → ${dstSlides}`);

            // (D) 페이지수 기록
            const pages = await readPagesFromSlidesPrefix(dstSlides);
            if (pages > 0) {
                await supabase.from("decks").update({ file_pages: pages }).eq("id", newDeckId);
                pushLog(setAssign, `페이지 수: ${pages}`);
            }

            // (E) room_decks 배정
            setAssign(s => ({ ...s, text: "교시 배정 중…", progress: 97 }));
            const map = await supabase.from("room_decks")
                .upsert({ room_id: roomId, slot, deck_id: newDeckId }, { onConflict: "room_id,slot" });
            if (map.error) throw map.error;

            setAssign(s => ({ ...s, text: "완료", progress: 100, deckId: newDeckId }));
            await sleep(250);
            setAssign(s => ({ ...s, open: false }));
        } catch (e: any) {
            console.error(e);
            setAssign(s => ({ ...s, text: e?.message ?? "오류", progress: 0 }));
            pushLog(setAssign, `오류: ${e?.message ?? e}`);
            alert(`배정 실패: ${e?.message ?? e}`);
        }
    }, [roomId]);

    /** UI 렌더링 */
    return (
        <div style={{ padding: 16, color: "#e2e8f0" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <button onClick={() => nav(`/teacher?room=${encodeURIComponent(roomCode)}`)} className="btn">뒤로</button>
                <div style={{ fontSize: 24, fontWeight: 800 }}>자료함</div>
                <div style={{ marginLeft: "auto" }} />
                <div>room: <b>{roomCode}</b></div>
            </div>

            <PdfToSlidesUploader
                roomCode={roomCode}
                onFinished={() => refreshList()}
            />

            {/* 교시 선택 */}
            <div style={{ margin: "10px 0", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ opacity: .8 }}>교시</span>
                {[1,2,3,4,5,6].map(n => (
                    <button
                        key={n}
                        onClick={() => setSlotSel(n)}
                        style={{
                            borderRadius: 10, padding: "6px 10px",
                            background: n === slotSel ? "rgba(59,130,246,.25)" : "rgba(148,163,184,.15)",
                            border: "1px solid rgba(148,163,184,.35)", color: "#e2e8f0"
                        }}
                    >{n}교시</button>
                ))}
            </div>

            {/* 카드 목록 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
                {rows.map(r => (
                    <div key={r.id} style={{ background: "rgba(15,23,42,.6)", border: "1px solid rgba(148,163,184,.25)", borderRadius: 12, padding: 12 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{r.title ?? "제목을 입력해주세요_"}</span>
                            <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 8, background: "rgba(16,185,129,.18)", border: "1px solid rgba(16,185,129,.45)", color: "#bbf7d0" }}>
                {badgeOf(r)}
              </span>
                        </div>

                        {/* 썸네일 영역(간단 프리뷰) */}
                        <div style={{ marginTop: 8, height: 160, background: "rgba(2,6,23,.7)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ opacity: .6 }}>썸네일</span>
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                            <button
                                onClick={() => assignDeckToSlot(r, slotSel)}
                                style={{ borderRadius: 10, padding: "8px 12px", background: "rgba(59,130,246,.25)", border: "1px solid rgba(59,130,246,.45)", color: "#bfdbfe" }}
                            >
                                지금 불러오기
                            </button>
                            <button
                                onClick={() => {
                                    if (!roomCode) return;
                                    if (!r.file_key) { alert("파일이 없습니다."); return; }
                                    if (r.origin === "db") nav(`/editor?room=${encodeURIComponent(roomCode)}&src=${encodeURIComponent(r.id)}`);
                                    else nav(`/editor?room=${encodeURIComponent(roomCode)}&srcKey=${encodeURIComponent(r.file_key)}`);
                                }}
                                style={{ borderRadius: 10, padding: "8px 12px", background: "rgba(148,163,184,.18)", border: "1px solid rgba(148,163,184,.35)", color: "#e2e8f0" }}
                            >
                                편집
                            </button>
                            <div style={{ marginLeft: "auto", fontSize: 12, opacity: .7 }}>
                                페이지: {r.file_pages ?? "-"}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 배정 진행 모달 */}
            {assign.open && (
                <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,.5)",
                    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
                }}>
                    <div style={{ width: 520, background: "#0b1220", color: "#cbd5e1", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
                        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>교시 배정</div>
                        <div style={{ fontSize: 13, marginBottom: 8 }}>{assign.text}</div>
                        <div style={{ height: 8, borderRadius: 6, background: "rgba(148,163,184,.25)", overflow: "hidden", marginBottom: 8 }}>
                            <div style={{ width: `${assign.progress}%`, height: 8, background: "#60a5fa" }} />
                        </div>
                        <div style={{ maxHeight: 180, overflow: "auto", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                            {assign.lines.map((l, i) => <div key={i}>• {l}</div>)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
