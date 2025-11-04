// src/pages/TeacherPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { loadSlides, type SlideMeta } from "../slideMeta";
import { RoomQR } from "../components/RoomQR";
import { getBasePath } from "../utils/getBasePath";
import { useRoomDecksSubscription } from "../hooks/useRoomDecksSubscription";
import PdfViewer from "../components/PdfViewer";

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
    time(label: string) {
        if (!DEBUG) return () => {};
        console.time(`[AUTOPPT] ${label}`);
        return () => console.timeEnd(`[AUTOPPT] ${label}`);
    },
};

function useToast(ms = 2400) {
    const [msg, setMsg] = useState<string>("");
    const [open, setOpen] = useState(false);
    const show = (m: string) => { setMsg(m); setOpen(true); setTimeout(() => setOpen(false), ms); };
    const node = open ? (
        <div style={{
            position:'fixed', left:'50%', bottom:24, transform:'translateX(-50%)',
            background:'rgba(17,24,39,0.98)', color:'#fff',
            border:'1px solid rgba(148,163,184,0.25)', borderRadius:12, padding:'10px 14px',
            boxShadow:'0 10px 24px rgba(0,0,0,0.35)', zIndex:60
        }}>{msg}</div>
    ) : null;
    return { show, node };
}

async function rpc<T = any>(name: string, params: Record<string, any>) {
    const stop = DBG.time(`rpc:${name}`);
    DBG.info("rpc →", name, params);
    const { data, error } = await supabase.rpc(name, params);
    stop();
    if (error) DBG.err("rpc ←", name, error);
    else DBG.ok("rpc ←", name, data);
    return { data: data as T | null, error };
}

function makeRoomCode(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export default function TeacherPage() {
    const nav = useNavigate();
    const loc = useLocation();
    const toast = useToast();

    // ----- room code / view mode -----
    const defaultCode = useMemo(() => "CLASS-" + makeRoomCode(), []);
    const roomCode = useRoomId(defaultCode);
    const qs = new URLSearchParams(loc.search);
    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";
    const setViewMode = (m: "present" | "setup") => {
        const next = new URLSearchParams(loc.search);
        next.set("mode", m);
        if (!next.get("room") && roomCode) next.set("room", roomCode);
        nav(`/teacher?${next.toString()}`, { replace: true });
    };

    // room param 보장
    useEffect(() => {
        const hasRoom = new URLSearchParams(loc.search).has("room");
        if (!hasRoom && roomCode) {
            const next = new URLSearchParams(loc.search);
            next.set("room", roomCode);
            if (!next.get("mode")) next.set("mode", "present");
            nav(`/teacher?${next.toString()}`, { replace: true });
        }
    }, [loc.search, nav, roomCode]);

    // ----- ownership / claim -----
    const claimedRef = useRef<string | null>(null);
    const [isOwner, setIsOwner] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode) return;
            if (claimedRef.current === roomCode) return;
            claimedRef.current = roomCode;

            const { data: claimOk, error } = await rpc<boolean>("claim_room_auth", { p_code: roomCode });
            if (cancelled) return;
            if (error) { setIsOwner(false); return; }
            if (claimOk !== true) {
                const next = "CLASS-" + makeRoomCode();
                await rpc("ensure_room", { p_code: next });
                toast.show("이미 사용 중인 코드입니다. 새 방을 만들었어요.");
                nav(`/teacher?room=${next}&mode=${viewMode}`, { replace: true });
                setIsOwner(false);
                return;
            }
            setIsOwner(true);
        })();

        const hb = setInterval(() => { rpc("heartbeat_room_auth", { p_code: roomCode }).catch(() => {}); }, 30_000);
        const onHide = () => { rpc("release_room_auth", { p_code: roomCode }).catch(() => {}); };
        window.addEventListener("pagehide", onHide);
        const onVis = () => { if (document.visibilityState === "visible") rpc("heartbeat_room_auth", { p_code: roomCode }).catch(() => {}); };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            clearInterval(hb);
            window.removeEventListener("pagehide", onHide);
            document.removeEventListener("visibilitychange", onVis);
            cancelled = true;
        };
    }, [roomCode, nav, viewMode]);

    // ----- room id / rooms state -----
    const [roomId, setRoomId] = useState<string | null>(null);
    const [state, setState] = useState<{ slide?: number; step?: number }>({});
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);

    /** 서버 rooms 값을 강제 재조회해서 즉시 로컬 반영 */
    const refreshRoomState = async () => {
        if (!roomCode) return;
        const { data, error } = await supabase
            .from("rooms")
            .select("id, current_deck_id, state")
            .eq("code", roomCode)
            .maybeSingle();
        if (!error && data) {
            setRoomId(data.id ?? null);
            setCurrentDeckId(data.current_deck_id ?? null);
            setState((data.state as any) ?? {});
        }
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode) return;
            await refreshRoomState(); // 최초 1회 강제 동기화

            const filter = `code=eq.${roomCode}`;
            const ch = supabase
                .channel(`rooms:${roomCode}`)
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter },
                    (payload) => {
                        const row: any = payload.new;
                        setCurrentDeckId(row.current_deck_id ?? null);
                        setState(row.state ?? {});
                    })
                .subscribe();
            return () => { supabase.removeChannel(ch); };
        })();
        return () => { cancelled = true; };
    }, [roomCode]);

    // ----- slides meta -----
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    useEffect(() => { loadSlides().then(setSlides).catch(() => setSlides([])); }, []);
    const currSlide = Number(state?.slide ?? 1);
    const currStep  = Number(state?.step  ?? 0);
    const stepsOfCurrent = (slides.find(s => s.slide === currSlide)?.steps) ?? [];
    const currentStepMeta = stepsOfCurrent[currStep];

    // ----- deck slots (for setup) -----
    const [slots, setSlots] = useState<{ slot: number; deck_id: string | null; title?: string | null; file_key?: string | null }[]>(
        Array.from({ length: 6 }, (_, i) => ({ slot: i + 1, deck_id: null }))
    );
    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
            if (!roomRow?.id) return;
            setRoomId(roomRow.id);
            const { data } = await supabase
                .from("room_decks")
                .select("slot, deck_id, decks(title,file_key)")
                .eq("room_id", roomRow.id)
                .order("slot", { ascending: true });
            if (data) {
                setSlots(Array.from({ length: 6 }, (_, i) => {
                    const found = data.find((d: any) => d.slot === i + 1);
                    return {
                        slot: i + 1, deck_id: found?.deck_id ?? null, title: (found as any)?.decks?.title ?? null, file_key: (found as any)?.decks?.file_key ?? null,};
                }));
            }
        })();
    }, [roomCode]);

    // 실시간 슬롯 업데이트
    const [decks, setDecks] = useState<Record<number, any>>({});
    useRoomDecksSubscription(roomId, (ev) => {
        setDecks((prev) => {
            const next = { ...prev };
            if (ev.eventType === "DELETE") { const slot = ev.old?.slot; if (slot in next) delete next[slot]; return next; }
            const row = ev.new;
            next[row.slot] = {
                deck_id: row.deck_id,
                title: row.title ?? next[row.slot]?.title ?? "",
                ext_id: row.ext_id ?? next[row.slot]?.ext_id ?? null,
                meta: row.meta ?? null,
            };
            return next;
        });
    });

    // ----- answers_v2 realtime (history live) -----
    const [history, setHistory] = useState<any[]>([]);
    useEffect(() => {
        if (!roomId) return;
        const ch = supabase
            .channel(`answers:${roomId}`)
            .on('postgres_changes',{
                event:'INSERT', schema:'public', table:'answers_v2', filter:`room_id=eq.${roomId}`
            }, (ev:any)=>{ setHistory((prev)=>[ev.new, ...prev].slice(0,50)); })
            .subscribe();
        return ()=>{ supabase.removeChannel(ch); };
    }, [roomId]);

    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            // v2 시도
            const { data: d1, error: e1 } = await supabase.rpc("fetch_history_by_code_v2", {
                p_room_code: roomCode, p_limit: 50, p_before: null,
            });
            if (!e1) { setHistory(d1 ?? []); return; }
            // v1 폴백
            const { data: d0, error: e0 } = await supabase.rpc("fetch_history_by_code", {
                p_room_code: roomCode, p_limit: 50, p_before: null,
            });
            if (!e0) setHistory(d0 ?? []);
        })();
    }, [roomCode, state]);

    // ----- deck file (PDF) -----
    const [deckFileUrl, setDeckFileUrl] = useState<string | null>(null);
    const getPublicUrl = (key: string) =>
        supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;

    useEffect(() => {
        (async () => {
            if (!currentDeckId || !roomId) { setDeckFileUrl(null); return; }
            // RLS 안전 경로: room_decks → decks(file_key)
                const { data: rd } = await supabase
                    .from("room_decks")
                    .select("decks(file_key)")
                    .eq("room_id", roomId)
                    .eq("deck_id", currentDeckId)
                    .maybeSingle();
                const fk = (rd as any)?.decks?.file_key;
                if (fk) setDeckFileUrl(getPublicUrl(fk));
                else setDeckFileUrl(null);
            })();
        }, [currentDeckId, roomId]);

    // ----- student URL -----
    const studentUrl = useMemo(() => {
        const origin = window.location.origin;
        const base = getBasePath();
        return `${origin}${base}/#/student?room=${roomCode}`;
    }, [roomCode]);

    // ----- actions -----
    const goto = async (nextSlide: number, nextStep: number) => {
        if (!isOwner) return;
        await rpc("goto_slide", { p_code: roomCode, p_slide: nextSlide, p_step: nextStep });
    };
    const next = async () => {
        const nStep = currStep + 1;
        if (nStep < stepsOfCurrent.length) await goto(currSlide, nStep);
        else await goto(currSlide + 1, 0);
    };
    const prev = async () => {
        if (currStep > 0) await goto(currSlide, currStep - 1);
        else if (currSlide > 1) {
            const prevSteps = (slides.find(s => s.slide === (currSlide - 1))?.steps ?? []);
            await goto(currSlide - 1, Math.max(0, prevSteps.length - 1));
        }
    };

    const [focusStudent, setFocusStudent] = useState<string|null>(null);
    const [focusList, setFocusList] = useState<any[]>([]);
    useEffect(() => {
              (async () => {
                      if (!roomId || !focusStudent) return;
                      const { data, error } = await supabase
                          .from("answers_v2")
                          .select("student_id, answer_value, answer, slide, step, created_at")
                          .eq("room_id", roomId).eq("student_id", focusStudent)
                          .order("created_at", { ascending: false }).limit(50);
                      if (!error) setFocusList(data ?? []);
                  })();
          }, [roomId, focusStudent]);

    // 발표 모드 단축키
    useEffect(() => {
        if (viewMode !== "present") return;
        const onKey = (e: KeyboardEvent) => {
            if (!isOwner) return;
            if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
            if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [viewMode, isOwner, currSlide, currStep, slides]);

    // 슬롯 배정/업로드(설정 모드)
    const [slotEdit, setSlotEdit] = useState<{ [k: number]: { ext?: string; title?: string } }>({});
    const assignSlot = async (slot: number) => {
        const ext = slotEdit[slot]?.ext?.trim() || "";
        const title = slotEdit[slot]?.title?.trim() || `Deck ${slot}`;
        if (!ext) { alert("ext_id를 입력하세요"); return; }
        const { error } = await rpc("assign_room_deck_by_ext", { p_code: roomCode, p_slot: slot, p_ext_id: ext, p_title: title });
        if (error) { alert("슬롯 배정 실패"); return; }

        // 즉시 동기화
        await refreshRoomState();

        // 슬롯 목록도 갱신
        const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        if (!roomRow?.id) return;
        const { data } = await supabase
            .from("room_decks")
            .select("slot, deck_id, decks(title)")
            .eq("room_id", roomRow.id)
            .order("slot");
        if (data) {
            setSlots(Array.from({ length: 6 }, (_, i) => {
                const found = data.find((d: any) => d.slot === i + 1);
                return { slot: i + 1, deck_id: found?.deck_id ?? null, title: (found as any)?.decks?.title ?? null };
            }));
        }
    };

    // 업로드 다이얼로그 상태
    const [uploadDlg, setUploadDlg] = useState<{ open: boolean; name: string; pct: number; previewUrl: string | null; msg?: string; }>
    ({ open: false, name: "", pct: 0, previewUrl: null, msg: "" });
    const openUploadDlg = (name: string) => setUploadDlg({ open: true, name, pct: 0, previewUrl: null, msg: "업로드 준비 중..." });
    const setUploadPct = (pct: number, msg?: string) => setUploadDlg((u) => ({ ...u, pct: Math.max(0, Math.min(100, pct)), msg: msg ?? u.msg }));
    const closeUploadDlg = () => setUploadDlg({ open: false, name: "", pct: 0, previewUrl: null, msg: "" });

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    async function uploadPdfForSlot(slot: number) {
        const s = slots.find((x) => x.slot === slot);
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/pdf";

        const toSlug = (name: string) =>
            name.replace(/\.(pdf|pptx?)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            openUploadDlg(file.name);
            let pct = 0;
            const timer = window.setInterval(() => { pct = Math.min(90, pct + 1); setUploadPct(pct, "업로드 중..."); }, 120);

            try {
                // rooms 보장
                const { data: existed } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
                const ensuredRoomId = existed?.id ?? (await rpc<string>("ensure_room", { p_code: roomCode })).data ?? null;
                if (!ensuredRoomId) { clearInterval(timer); setUploadPct(100, "방 정보를 찾지 못했습니다."); return; }

                // 1) 덱 확보
                let deckId = s?.deck_id ?? null;
                const baseTitle = toSlug(file.name) || `deck-${slot}`;
                if (!deckId) {
                       const { data: created, error: cErr } = await rpc< string >("create_deck_and_assign", {
                             p_code: roomCode, p_slot: slot, p_title: baseTitle, p_slug: toSlug(file.name)   // p_slug는 옵션
                       });
                       if (cErr) { clearInterval(timer); setUploadPct(100, "덱 생성 실패"); return; }
                       deckId = created!;
                     } else {
                       // 기존 슬롯이면 그대로 유지(제목 변경 필요 없으면 패스)
                }

                // 2) 업로드
                const extOrId = (extForUpdate ?? deckId) as string;
                let key = `rooms/${ensuredRoomId}/decks/${extOrId}/slides-${Date.now()}.pdf`;
                let up = await supabase.storage.from("presentations")
                    .upload(key, file, { upsert: true, contentType: "application/pdf" });
                if (up.error) { clearInterval(timer); setUploadPct(100, "업로드 실패"); console.error(up.error); return; }

                // 3) decks.file_key 갱신(슬롯 기준: RLS/식별자 혼선 없이 보장)
                setUploadPct(92, "파일 링크 갱신 중...");
                const { error: updErr } = await rpc("upsert_deck_file_by_slot", {
                    p_room_code: roomCode, p_slot: slot, p_file_key: key
                });
                if (updErr) { clearInterval(timer); setUploadPct(100, "파일 등록 실패"); toast.show("파일 등록 실패: upsert_deck_file_by_slot"); return; }

                //  3.5) 업로드한 슬롯을 '현재 교시'로 즉시 선택 + 1/0으로 진입 (항상)
                const { error: selErr } = await rpc("set_room_deck", { p_code: roomCode, p_slot: slot });
                if (selErr) { clearInterval(timer); setUploadPct(100, "전환 실패"); toast.show("전환 실패: set_room_deck"); return; }
                const { error: gotoErr } = await rpc("goto_slide", { p_code: roomCode, p_slide: 1, p_step: 0 });
                if (gotoErr) { /* 치명적이진 않음 */ toast.show("슬라이드 이동 실패: goto_slide"); }
                
                // 4) 현재 교시에 반영(선택 사항이지만 편의상 유지)
                const publicUrl = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                if (deckId && currentDeckId === deckId) setDeckFileUrl(publicUrl);

                // 5) 슬롯 목록 갱신(+file_key) + rooms 상태 즉시 동기화
                await refreshRoomState();
                const { data } = await supabase
                    .from("room_decks")
                    .select("slot, deck_id, decks(title,file_key)")
                    .eq("room_id", ensuredRoomId)
                    .order("slot");
                if (data) {
                    setSlots(Array.from({ length: 6 }, (_, i) => {
                        const found = data.find((d: any) => d.slot === i + 1);
                        return {
                            slot: i + 1,
                                deck_id: found?.deck_id ?? null,
                                title: (found as any)?.decks?.title ?? null,
                                file_key: (found as any)?.decks?.file_key ?? null,
                        };                    
                    }));
                }

                clearInterval(timer);
                setUploadPct(100, "업로드 완료!");
                setUploadDlg((u) => ({ ...u, previewUrl: publicUrl }));
                toast.show("업로드 완료");
            } catch (e) {
                console.error(e);
                clearInterval(timer);
                setUploadPct(100, "업로드 실패");
            }
        };

        input.click();
    }

    // ----- views -----
    const PresentView = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>슬라이드 {currSlide} / 스텝 {currStep}</div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
            </div>
            <div style={{ display: "grid", placeItems: "center" }}>
                {deckFileUrl ? (
                    <div className="pdf-stage"><PdfViewer fileUrl={deckFileUrl} page={currSlide} /></div>
                ) : currentStepMeta?.img ? (
                    <img src={currentStepMeta.img} alt="current" style={{ maxWidth: "100%", borderRadius: 12 }} />
                ) : (
                    <div style={{ opacity: 0.6 }}>자료가 없습니다.</div>
                )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev} disabled={!isOwner}>◀ 이전</button>
                <button className="btn" onClick={() => goto(currSlide, currStep)} disabled={!isOwner}>🔓 현재 스텝 해제</button>
                <button className="btn" onClick={next} disabled={!isOwner}>다음 ▶</button>
            </div>
        </div>
    );

    const SetupView = (
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
            {/* 좌측: 진행+슬롯 설정 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="panel">
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                        현재 교시: {currentDeckId ? "선택됨" : "미선택"} · 슬라이드 {currSlide} / 스텝 {currStep}
                    </div>
                    {deckFileUrl ? (
                        <div className="pdf-stage"><PdfViewer fileUrl={deckFileUrl} page={currSlide} /></div>
                    ) : currentStepMeta?.img ? (
                        <img src={currentStepMeta.img} alt="current" style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 8 }} />
                    ) : null}
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={next} disabled={!isOwner}>⏭ 다음</button>
                        <button className="btn" onClick={() => goto(currSlide, currStep)} disabled={!isOwner}>🔓 현재 스텝 해제</button>
                        <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
                    </div>
                </div>

                <div className="panel">
                    <h3 style={{ marginTop: 0 }}>교시 전환(1~6) & 자료 연결</h3>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
                        {slots.map((s) => (
                            <div key={s.slot} className="card" style={{ padding: 8, borderRadius: 10 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>{s.slot}교시</div>
                                <div style={{ fontSize: 12, opacity: 0.8, minHeight: 18 }}>
                                    {s.title || (s.deck_id ? s.deck_id.slice(0, 8) : "미배정")}
                                     </div>
                                {s.file_key && (
                                    <div className="pdf-thumb" style={{ marginTop: 6, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(148,163,184,.25)" }}>
                                        <div style={{ height: 120, maxWidth: "100%", background: "rgba(30,41,59,.35)" }}>
                                            <PdfViewer fileUrl={getPublicUrl(s.file_key)} page={1} />
                                        </div>
                                       </div>
                                )}
                                <button
                                    className="btn" style={{ marginTop: 6 }}
                                    onClick={async () => {
                                        const { data: newDeckId, error } = await supabase.rpc("set_room_deck", {
                                            p_code: roomCode, p_slot: s.slot,
                                        });
                                        if (error) { toast.show("전환 실패: " + error.message); return; }
                                        if (newDeckId) setCurrentDeckId(String(newDeckId));
                                        const { error: e2 } = await supabase.rpc("goto_slide", { p_code: roomCode, p_slide: 1, p_step: 0 });
                                        if (e2) { toast.show("슬라이드 이동 실패: " + e2.message); }
                                        await refreshRoomState();
                                    }}
                                    disabled={!isOwner}
                                >전환</button>
                                <button className="btn" style={{ marginTop: 6 }} onClick={() => uploadPdfForSlot(s.slot)} disabled={!isOwner}>
                                    PDF 업로드
                                </button>
                                <div style={{ marginTop: 8 }}>
                                    <input
                                        className="input"
                                        placeholder="ext_id(파일ID/slug)"
                                        value={slotEdit[s.slot]?.ext ?? ""}
                                        onChange={(e) => setSlotEdit((prev) => ({ ...prev, [s.slot]: { ...prev[s.slot], ext: e.target.value } }))}
                                    />
                                    <input
                                        className="input"
                                        style={{ marginTop: 6 }}
                                        placeholder="표시 제목"
                                        value={slotEdit[s.slot]?.title ?? ""}
                                        onChange={(e) => setSlotEdit((prev) => ({ ...prev, [s.slot]: { ...prev[s.slot], title: e.target.value } }))}
                                    />
                                    <button className="btn" style={{ marginTop: 6 }} onClick={() => assignSlot(s.slot)} disabled={!isOwner}>
                                        슬롯 배정/변경
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 우측: QR + 제출 기록 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <RoomQR url={studentUrl} />
                <div className="panel">
                    <h3 style={{ marginTop: 0 }}>최근 제출 기록</h3>
                    <div style={{ maxHeight: 280, overflowY: "auto" }}>
                        {history.length === 0 ? (
                            <p style={{ opacity: 0.6 }}>기록 없음</p>
                        ) : (
                            history.map((h, idx) => (
                                <div key={idx}
                                     onClick={()=> h.student_id && setFocusStudent(h.student_id)}
                                        style={{ borderBottom:"1px solid rgba(148,163,184,0.12)", padding:"6px 0", cursor:"pointer" }}>                                    <div style={{ fontSize: 13 }}><b>{h.student_id ?? "익명"}</b> → {h.answer_value ?? h.answer ?? ""}</div>
                                    <div style={{ fontSize: 11, opacity: 0.65 }}>slide {h.slide} / step {h.step} · {h.created_at}</div>
                                </div>
                            ))
                        )}
                    </div>
                    {focusStudent && (
                            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"grid", placeItems:"center", zIndex:70 }}>
                                  <div className="panel" style={{ width:720, maxWidth:"95vw", maxHeight:"85vh", overflow:"auto" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <h3 style={{ margin:0, flex:1 }}>제출 내역: {focusStudent}</h3>
                                      <button className="btn" onClick={()=>setFocusStudent(null)}>닫기</button>
                                    </div>
                                    <div style={{ marginTop:8 }}>
                                      {focusList.length===0 ? <div style={{opacity:.6}}>기록 없음</div> : (
                                        <div style={{ display:"grid", gap:6 }}>
                                                {focusList.map((r,i)=>(
                                                 <div key={i} style={{ border:"1px solid rgba(148,163,184,.2)", borderRadius:8, padding:8 }}>
                                                      <div style={{ fontSize:13 }}><b>slide {r.slide}</b> / step {r.step}</div>
                                                      <div style={{ fontSize:14 }}>{r.answer_value ?? r.answer ?? ""}</div>
                                                      <div style={{ fontSize:11, opacity:.65 }}>{r.created_at}</div>
                                                    </div>
                                              ))}
                                            </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                          )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="app-shell">
            <div className="topbar">
                <h1 style={{ margin: 0 }}>교사 {viewMode === "present" ? "발표" : "설정"}</h1>
                <span className="badge">권한: {isOwner ? "ON" : "OFF"}</span>
                <span className="badge">room: {roomCode}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className={`btn ${viewMode==='present'?'btn-primary':''}`} onClick={() => setViewMode("present")}>발표</button>
                    <button className={`btn ${viewMode==='setup'?'btn-primary':''}`} onClick={() => setViewMode("setup")}>설정</button>
                    <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
                </div>
            </div>

            {viewMode === "present" ? PresentView : SetupView}

            {/* 업로드 진행/미리보기 모달 */}
            {uploadDlg.open && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"grid", placeItems:"center", zIndex:70 }}>
                    <div className="panel" style={{ width: 680, maxWidth: "92vw" }}>
                        <h3 style={{ marginTop:0 }}>파일 업로드: <span style={{ opacity:.8 }}>{uploadDlg.name}</span></h3>
                        {!uploadDlg.previewUrl && (
                            <>
                                <div style={{ height: 10, background:"rgba(148,163,184,0.2)", borderRadius: 8, overflow: "hidden" }}>
                                    <div style={{ width: `${uploadDlg.pct}%`, height: "100%", background:"#60a5fa", transition:"width .2s ease" }}/>
                                </div>
                                <div style={{ marginTop: 8, fontSize: 13, opacity:.8 }}>{uploadDlg.msg} {uploadDlg.pct}%</div>
                            </>
                        )}
                        {uploadDlg.previewUrl && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize:12, opacity:.7, marginBottom:6 }}>업로드가 완료되었습니다. 미리보기:</div>
                                <div className="pdf-stage" style={{ maxHeight: 460, overflow:"auto" }}>
                                    <PdfViewer fileUrl={uploadDlg.previewUrl} page={1} />
                                </div>
                            </div>
                        )}
                        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop: 12 }}>
                            <button className="btn" onClick={closeUploadDlg}>닫기</button>
                        </div>
                    </div>
                </div>
            )}
            {toast.node}
        </div>
    );
}
