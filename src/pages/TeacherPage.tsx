// src/pages/TeacherPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useRoomDecksSubscription } from "../hooks/useRoomDecksSubscription";
import { loadSlides, type SlideMeta } from "../slideMeta";
import PdfViewer from "../components/PdfViewer";
import { getBasePath } from "../utils/getBasePath";

type DeckSlot = { slot: number; deck_id: string | null; title?: string | null; file_key?: string | null };

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

async function rpc(fn: string, args?: Record<string, any>) {
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) { DBG.err("rpc error:", fn, error.message || error); throw error; }
    return data;
}

async function tryRpc(name: string, args: Record<string, any>) {
    try {
        return await rpc(name, args);
    } catch (e: any) {
        DBG.err(`rpc fail: ${name}`, e?.message || e);
        throw e;
    }
}

/** 업로드 후 decks.file_key를 반드시 세팅한다(신/구 RPC 모두 시도).
 *  1) upsert_deck_file_by_slot(p_room_code, p_slot, p_file_key)
 *  2) upsert_deck_file(p_room_code, p_slot, p_file_key)           // legacy A
 *  3) upsert_deck_file(p_deck_id, p_file_key)                     // legacy B
 *  4) (최후) 테이블 업데이트(선생님 계정 RLS 허용 시)
 */
async function ensureDeckFileKey(opts: { roomCode: string; slot: number; deckId: string; fileKey: string; }) {
    const { roomCode, slot, deckId, fileKey } = opts;
    try { await tryRpc("upsert_deck_file_by_slot", { p_room_code: roomCode, p_slot: slot, p_file_key: fileKey }); DBG.ok("file_key via by_slot"); return; } catch {}
    try { await tryRpc("upsert_deck_file",          { p_room_code: roomCode, p_slot: slot, p_file_key: fileKey }); DBG.ok("file_key via upsert(room,slot)"); return; } catch {}
    try { await tryRpc("upsert_deck_file",          { p_deck_id: deckId,     p_file_key: fileKey });              DBG.ok("file_key via upsert(deck)"); return; } catch {}
    const { error } = await supabase.from("decks").update({ file_key: fileKey }).eq("id", deckId);
    if (!error) { DBG.ok("file_key via direct update"); return; }
    DBG.err("file_key set failed", error?.message || error);
    try { await tryRpc("upsert_deck_file_by_id", { p_deck_id: deckId, p_file_key: fileKey }); DBG.ok("file_key via by_id"); return; } catch {}
    throw error;
}

function useQS() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

function useToast(ms = 2400) {
    const [open, setOpen] = useState(false);
    const [msg, setMsg] = useState("");
    const show = (m: string) => { setMsg(m); setOpen(true); setTimeout(() => setOpen(false), ms); };
    const node = open ? (
        <div style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "rgba(17,24,39,0.98)", color: "#fff", border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 24px rgba(0,0,0,0.35)", zIndex: 60
        }}>{msg}</div>
    ) : null;
    return { show, node };
}

export default function TeacherPage() {
    const nav = useNavigate();
    const qs = useQS();
    const toast = useToast();

    // ---- Room ----
    const defaultCode = useMemo(() => "CLASS-" + Math.random().toString(36).slice(2, 8).toUpperCase(), []);
    const roomCode = useRoomId(defaultCode);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [state, setState] = useState<{ slide?: number; step?: number }>({});
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);
    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";

    useEffect(() => {
        const url = new URLSearchParams(qs.toString());
        if (!url.get("room") && roomCode) {
            url.set("room", roomCode);
            if (!url.get("mode")) url.set("mode", "present");
            nav(`/teacher?${url.toString()}`, { replace: true });
        }
    }, [roomCode]);

    // ---- Slides meta (이미지 폴백용) ----
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    useEffect(() => { loadSlides().then(setSlides).catch(() => setSlides([])); }, []);
    const orderedSlides = useMemo(() => [...slides].sort((a,b)=>a.slide-b.slide), [slides]);

    const currSlide = Number(state?.slide ?? 1);
    const currStep  = Number(state?.step ?? 0);
    const currentSlideIndex = useMemo(
        () => orderedSlides.findIndex(s => s.slide === currSlide),
        [orderedSlides, currSlide]
    );
    const stepsOfCurrent = orderedSlides[currentSlideIndex]?.steps ?? [];
    const currentStepMeta = stepsOfCurrent[currStep];

    // ---- Room row ----
    const refreshRoomState = useCallback(async () => {
        if (!roomCode) return;
        const { data, error } = await supabase
            .from("rooms")
            .select("id, current_deck_id, state")
            .eq("code", roomCode)
            .maybeSingle();
        if (error) return;
        if (data) {
            setRoomId(data.id);
            setCurrentDeckId(data.current_deck_id ?? null);
            if (data.state) setState({ slide: data.state.slide ?? 1, step: data.state.step ?? 0 });
        }
    }, [roomCode]);
    useEffect(() => { refreshRoomState(); }, [refreshRoomState]);

    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            try {
                await rpc("claim_room_auth", { p_code: roomCode });
                await refreshRoomState(); // id, current_deck_id, state 동기화
            } catch (e) {
                DBG.err("claim_room_auth failed", e);
            }
        })();
    }, [roomCode, refreshRoomState]);
    
    // ---- Slots ----
    const [slots, setSlots] = useState<DeckSlot[]>(() => Array.from({ length: 6 }, (_, i) => ({ slot: i+1, deck_id: null })));
    useEffect(() => {
        (async () => {
            if (!roomId) return;
            const { data } = await supabase
                .from("room_decks")
                .select("slot, deck_id, decks(title,file_key)")
                .eq("room_id", roomId)
                .order("slot", { ascending: true });
            if (!data) return;
            setSlots(Array.from({ length: 6 }, (_, i) => {
                const found: any = data.find((d: any) => d.slot === i+1) ?? {};
                return {
                    slot: i+1,
                    deck_id: found.deck_id ?? null,
                    title: found?.decks?.title ?? null,
                    file_key: found?.decks?.file_key ?? null,
                };
            }));
        })();
    }, [roomId]);

    useRoomDecksSubscription(roomId, () => { refreshRoomState(); });

    // ---- Realtime ----
    const { lastMessage, send } = useRealtime(roomCode, "teacher");
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "hello") {
            send({ type: "goto", slide: currSlide, step: currStep });
        }
    }, [lastMessage, currSlide, currStep, send]);

    // ---- Student URL ----
    const studentUrl = useMemo(() => {
        const base = getBasePath();
        return `${base}/#/student?room=${roomCode}`;
    }, [roomCode]);

    // ---- Current deck file url ----
    const [deckFileUrl, setDeckFileUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode || !currentDeckId) { setDeckFileUrl(null); return; }

            // 1) 서버에서 안전하게 현재 교시의 file_key 조회
            try {
                const key = await rpc("get_current_deck_file_key", { p_code: roomCode });
                if (cancelled) return;
                if (key) {
                    const url = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                    setDeckFileUrl(url);
                    return;
                }
            } catch (e) {
                DBG.err("get_current_deck_file_key", e);
            }

            // 2) key가 비어 있으면: 스토리지에서 추정 경로의 최신 파일을 찾아 자동 복구
            //    rooms/<roomId>/decks/<currentDeckId>/ 아래 최신 파일을 1개 조회 → file_key 백필
            if (!roomId) { setDeckFileUrl(null); return; }
            const basePath = `rooms/${roomId}/decks/${currentDeckId}`;
            try {
                const listed = await supabase.storage.from("presentations").list(basePath, { limit: 1, sortBy: { column: "created_at", order: "desc" } });
                const name = listed.data?.[0]?.name;
                if (name) {
                    const guessKey = `${basePath}/${name}`;
                    // 백엔드에 by_id로 file_key 저장 → 이후부터는 정상 경로로 동작
                    try { await rpc("upsert_deck_file_by_id", { p_deck_id: currentDeckId, p_file_key: guessKey }); } catch {}
                    if (!cancelled) {
                        const url = supabase.storage.from("presentations").getPublicUrl(guessKey).data.publicUrl;
                        setDeckFileUrl(url);
                    }
                } else {
                    if (!cancelled) setDeckFileUrl(null);
                }
            } catch {
                if (!cancelled) setDeckFileUrl(null);
            }
        })();
        return () => { cancelled = true; };
    }, [roomCode, roomId, currentDeckId]);


    // ---- Controls ----
    const goto = useCallback(async (nextSlide: number, nextStep: number) => {
        await rpc("goto_slide", { p_code: roomCode, p_slide: nextSlide, p_step: nextStep });
        setState({ slide: nextSlide, step: nextStep });
        send({ type: "goto", slide: nextSlide, step: nextStep });
    }, [roomCode, send]);

    const next = useCallback(async () => {
        const hasNextStep = currStep + 1 < stepsOfCurrent.length;
        if (hasNextStep) { await goto(currSlide, currStep + 1); return; }
        if (currentSlideIndex >= 0 && currentSlideIndex + 1 < orderedSlides.length) {
            const ns = orderedSlides[currentSlideIndex + 1];
            await goto(ns.slide, 0);
        }
    }, [currSlide, currStep, stepsOfCurrent.length, currentSlideIndex, orderedSlides, goto]);

    const prev = useCallback(async () => {
        if (currStep > 0) { await goto(currSlide, currStep - 1); return; }
        if (currentSlideIndex > 0) {
            const ps = orderedSlides[currentSlideIndex - 1];
            const last = Math.max(0, (ps?.steps?.length ?? 1) - 1);
            await goto(ps.slide, last);
        }
    }, [currSlide, currStep, currentSlideIndex, orderedSlides, goto]);

    // ---- Upload ----
    const [uploading, setUploading] = useState<{ open: boolean; name?: string; pct?: number; previewUrl?: string | null; msg?: string }>({
        open: false, name: "", pct: 0, previewUrl: null, msg: ""
    });
    const openUploadDlg = (name: string) => setUploading({ open: true, name, pct: 0, previewUrl: null, msg: "업로드 준비 중..." });
    const setPct = (pct: number, msg?: string) => setUploading(u => ({ ...u, pct: Math.max(0, Math.min(100, pct)), msg: msg ?? u.msg }));
    const closeUpload = () => setUploading({ open: false, name: "", pct: 0, previewUrl: null, msg: "" });

    async function uploadPdfForSlot(slot: number) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "application/pdf";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            openUploadDlg(file.name);
            let pct = 0;
            const timer = window.setInterval(() => { pct = Math.min(90, pct + 1); setPct(pct, "업로드 중..."); }, 120);

            try {
                // ✅ 방 생성/귀속 보장
                await rpc("claim_room_auth", { p_code: roomCode });

                // ✅ room id 재조회(여기서 무조건 존재)
                let ensuredRoomId = roomId;
                if (!ensuredRoomId) {
                    const { data } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
                    ensuredRoomId = data?.id ?? null;
                    setRoomId(ensuredRoomId);
                }
                if (!ensuredRoomId) throw new Error("room id missing");

                // slot → deck ensure
                const { data: rd } = await supabase
                    .from("room_decks")
                    .select("deck_id")
                    .eq("room_id", ensuredRoomId)
                    .eq("slot", slot)
                    .maybeSingle();
                let deckId: string | null = rd?.deck_id ?? null;
                if (!deckId) {
                    const fallbackExt = `deck-${Date.now().toString(36)}`;
                    await rpc("assign_room_deck_by_ext", { p_code: roomCode, p_slot: slot, p_ext_id: fallbackExt, p_title: file.name.replace(/\.pdf$/i, "") });
                    const { data: rd2 } = await supabase.from("room_decks").select("deck_id").eq("room_id", ensuredRoomId).eq("slot", slot).maybeSingle();
                    deckId = rd2?.deck_id ?? null;
                    if (!deckId) throw new Error("deck create failed");
                }

                // upload to storage
                const key = `rooms/${ensuredRoomId}/decks/${deckId}/slides-${Date.now()}.pdf`;
                const up = await supabase.storage.from("presentations").upload(key, file, { upsert: true, contentType: "application/pdf" });
                if (up.error) throw up.error;
                setPct(92, "파일 링크 갱신 중...");

                // ← 핵심: 어떤 백엔드여도 file_key를 반드시 세팅
                await ensureDeckFileKey({ roomCode, slot, deckId, fileKey: key });

                // set current deck
                await rpc("set_room_deck", { p_code: roomCode, p_slot: slot });
                await refreshRoomState();

                // live preview
                const publicUrl = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                setUploading(u => ({ ...u, previewUrl: publicUrl }));
                setPct(100, "완료");
                window.clearInterval(timer);
                toast.show("업로드 완료");
            } catch (e) {
                console.error(e);
                window.clearInterval(timer);
                setPct(100, "실패");
                toast.show("업로드 실패");
            }
        };
        input.click();
    }

    const Badge: React.FC<React.PropsWithChildren<{ muted?: boolean }>> = ({ children, muted }) => (
        <span style={{
            border: "1px solid rgba(148,163,184,0.25)", borderRadius: 999, padding: "2px 8px",
            fontSize: 12, color: muted ? "#94a3b8" : "#e5e7eb"
        }}>{children}</span>
    );

    // ---- Views ----
    const PresentView = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>슬라이드 {currSlide} / 스텝 {currStep}</div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
            </div>
            <div style={{ display: "grid", placeItems: "center" }}>
                {deckFileUrl ? (
                    <div className="pdf-stage" style={{ width: "100%" }}>
                        <PdfViewer key={`${deckFileUrl}|${currentDeckId}`} fileUrl={deckFileUrl} page={currSlide} />
                    </div>
                ) : currentStepMeta?.img ? (
                    <img
                        src={`${getBasePath()}${currentStepMeta.img ?? ""}`}
                        alt="current"
                        style={{ maxWidth: "100%", borderRadius: 12 }}
                    />
                ) : (
                    <div style={{ opacity: 0.6 }}>자료가 없습니다.</div>
                )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev}>◀ 이전</button>
                <button className="btn" onClick={() => goto(currSlide, currStep)}>🔓 현재 스텝 해제</button>
                <button className="btn" onClick={next}>다음 ▶</button>
            </div>
        </div>
    );

    const SetupView = (
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
            <div className="panel">
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                    현재 교시: {currentDeckId ? "선택됨" : "미선택"} · 슬라이드 {currSlide} / 스텝 {currStep}
                </div>
                {deckFileUrl ? (
                    <div className="pdf-stage">
                        <PdfViewer key={`${deckFileUrl}|${currSlide}`} fileUrl={deckFileUrl} page={currSlide} maxHeight="500px" />
                    </div>
                ) : currentStepMeta?.img ? (
                    <img
                        src={`${getBasePath()}${currentStepMeta.img ?? ""}`}
                        alt="current"
                        style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 8 }}
                    />
                ) : (
                    <div style={{ opacity: 0.6 }}>자료가 없습니다.</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                    <button className="btn" onClick={prev}>◀ 이전</button>
                    <button className="btn" onClick={() => goto(currSlide, currStep)}>🔓 현재 스텝 해제</button>
                    <button className="btn" onClick={next}>다음 ▶</button>
                </div>
            </div>

            <div className="panel">
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>슬롯</div>
                    <button className="btn" style={{ marginLeft: "auto" }} onClick={() => nav(`/library?room=${roomCode}`)}>자료함 열기</button>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                    {slots.map(s => (
                        <div key={s.slot} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 10, alignItems: "center" }}>
                            <Badge muted>{s.slot}교시</Badge>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.deck_id ? (s.title || s.deck_id) : <span style={{ opacity: 0.6 }}>비어 있음</span>}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn" onClick={() => uploadPdfForSlot(s.slot)}>업로드</button>
                                <button className="btn" disabled={!s.deck_id} onClick={async () => {
                                    if (!s.deck_id) return;
                                    await rpc("set_room_deck", { p_code: roomCode, p_slot: s.slot });
                                    await refreshRoomState();
                                }}>불러오기</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className="app-shell" style={{ maxWidth: 940 }}>
            <div className="topbar" style={{ marginBottom: 12 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>교사 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">{currentDeckId ? "교시 선택됨" : "교시 미선택"}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=present`)} aria-pressed={viewMode === "present"}>발표</button>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)} aria-pressed={viewMode === "setup"}>설정</button>
                </div>
            </div>

            {viewMode === "present" ? PresentView : SetupView}

            {uploading.open && (
                <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)", zIndex: 70 }}>
                    <div className="panel" style={{ width: "min(92vw, 720px)", maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <div style={{ fontWeight: 700 }}>PDF 업로드</div>
                            <button className="btn" onClick={closeUpload}>×</button>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>{uploading.name}</div>
                        <div style={{ height: 8, background: "#111827", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ width: `${uploading.pct ?? 0}%`, height: "100%" }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{uploading.msg}</div>

                        {uploading.previewUrl && (
                            <div style={{ marginTop: 12 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>미리보기 (1페이지)</div>
                                <div className="pdf-stage" style={{ maxHeight: "300px", overflow: "auto" }}>
                                    <PdfViewer fileUrl={uploading.previewUrl} page={1} maxHeight="280px" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {toast.node}
        </div>
    );
}
