import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { loadSlides, type SlideMeta } from "../slideMeta";
import { RoomQR } from "../components/RoomQR";
import { getBasePath } from "../utils/getBasePath";
import { useRoomDecksSubscription } from "../hooks/useRoomDecksSubscription";

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

async function rpc<T = any>(name: string, params: Record<string, any>) {
    const stop = DBG.time(`rpc:${name}`);
    DBG.info("rpc →", name, params);
    const { data, error } = await supabase.rpc(name, params);
    stop();
    if (error) DBG.err("rpc ←", name, error);
    else DBG.ok("rpc ←", name, data);
    return { data: data as T | null, error };
}

if (typeof window !== "undefined") {
    // @ts-ignore
    (window).sb = supabase;
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

    const defaultCode = useMemo(() => "CLASS-" + makeRoomCode(), []);
    const roomCode = useRoomId(defaultCode);

    const [roomId, setRoomId] = useState<string | null>(null);

    useEffect(() => {
        const hasRoom = new URLSearchParams(loc.search).has("room");
        if (!hasRoom && roomCode) nav(`/teacher?room=${roomCode}`, { replace: true });
    }, [loc.search, nav, roomCode]);

    const claimedRef = useRef<string | null>(null);
    const [isOwner, setIsOwner] = useState(false);

    const [decks, setDecks] = useState<Record<number, any>>({});

    useRoomDecksSubscription(roomId, (ev) => {
        setDecks((prev) => {
            const next = { ...prev };
            if (ev.eventType === "DELETE") {
                const slot = ev.old?.slot;
                if (slot in next) delete next[slot];
                return next;
            }
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

    useEffect(() => {
        let cancelled = false;

        DBG.info("TeacherPage mount", { room: roomCode });

        (async () => {
            if (!roomCode) return;
            if (claimedRef.current === roomCode) return;
            claimedRef.current = roomCode;

            // 방 보장 & 점유
            const { data: claimOk, error } = await rpc<boolean>("claim_room_auth", { p_code: roomCode });
            if (cancelled) return;
            if (error) {
                setIsOwner(false);
                return;
            }
            if (claimOk !== true) {
                const next = "CLASS-" + makeRoomCode();
                await rpc("ensure_room", { p_code: next });
                nav(`/teacher?room=${next}`, { replace: true });
                setIsOwner(false);
                return;
            }
            setIsOwner(true);
        })();

        const hb = setInterval(() => {
            rpc("heartbeat_room_auth", { p_code: roomCode });
        }, 30_000);

        const onBye = () => rpc("release_room_auth", { p_code: roomCode });
        window.addEventListener("beforeunload", onBye);

        return () => {
            cancelled = true;
            clearInterval(hb);
            window.removeEventListener("beforeunload", onBye);
        };
    }, [roomCode, nav]);

    const [slides, setSlides] = useState<SlideMeta[]>([]);
    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    const [state, setState] = useState<{ slide?: number; step?: number }>({});
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode) return;

            // 초깃값: id 포함(Realtime 구독용)
            const { data, error } = await supabase
                .from("rooms")
                .select("id, current_deck_id, state")
                .eq("code", roomCode)
                .maybeSingle();

            if (!cancelled && !error && data) {
                setRoomId(data.id ?? null);
                setCurrentDeckId(data.current_deck_id ?? null);
                setState((data.state as any) ?? {});
            }

            const channel = supabase
                .channel(`rooms:${roomCode}`)
                .on(
                    "postgres_changes",
                    { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${roomCode}` },
                    (payload) => {
                        const row: any = payload.new;
                        setCurrentDeckId(row.current_deck_id ?? null);
                        setState(row.state ?? {});
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        })();

        return () => {
            cancelled = true;
        };
    }, [roomCode]);

    const [slots, setSlots] = useState<{ slot: number; deck_id: string | null; title?: string | null }[]>(
        Array.from({ length: 6 }, (_, i) => ({ slot: i + 1, deck_id: null }))
    );

    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
            if (!roomRow?.id) return;
            setRoomId(roomRow.id); // ← roomId 세팅(보강)

            const { data } = await supabase
                .from("room_decks")
                .select("slot, deck_id, decks(title)")
                .eq("room_id", roomRow.id)
                .order("slot", { ascending: true });

            if (data) {
                setSlots(
                    Array.from({ length: 6 }, (_, i) => {
                        const found = data.find((d: any) => d.slot === i + 1);
                        return { slot: i + 1, deck_id: found?.deck_id ?? null, title: (found as any)?.decks?.title ?? null };
                    })
                );
            }
        })();
    }, [roomCode]);

    const [slotEdit, setSlotEdit] = useState<{ [k: number]: { ext?: string; title?: string } }>({});
    const assignSlot = async (slot: number) => {
        const ext = slotEdit[slot]?.ext?.trim() || "";
        const title = slotEdit[slot]?.title?.trim() || `Deck ${slot}`;
        if (!ext) { alert("ext_id를 입력하세요"); return; }
        const { error } = await rpc("assign_room_deck_by_ext", {
            p_code: roomCode, p_slot: slot, p_ext_id: ext, p_title: title
        });
        if (error) { alert("슬롯 배정 실패"); return; }

        const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        if (!roomRow?.id) return;
        const { data } = await supabase
            .from("room_decks")
            .select("slot, deck_id, decks(title)")
            .eq("room_id", roomRow.id)
            .order("slot");
        if (data) {
            setSlots(
                Array.from({ length: 6 }, (_, i) => {
                    const found = data.find((d: any) => d.slot === i + 1);
                    return { slot: i + 1, deck_id: found?.deck_id ?? null, title: (found as any)?.decks?.title ?? null };
                })
            );
        }
    };

    const selectPeriod = async (slot: number) => {
        if (!isOwner) return;
        const { error } = await rpc("set_room_deck", { p_code: roomCode, p_slot: slot });
        if (error) { alert("교시 전환 실패(먼저 슬롯에 덱을 배정하세요)"); return; }
        await rpc("goto_slide", { p_code: roomCode, p_slide: 1, p_step: 0 });
    };

    const currSlide = Number(state?.slide ?? 1);
    const currStep  = Number(state?.step ?? 0);
    const [slidesMeta, setSlidesMeta] = useState<SlideMeta[]>([]);
    useEffect(() => setSlidesMeta(slides), [slides]);

    const goto = async (nextSlide: number, nextStep: number) => {
        if (!isOwner) return;
        await rpc("goto_slide", { p_code: roomCode, p_slide: nextSlide, p_step: nextStep });
    };
    const next = async () => {
        const steps = (slidesMeta.find((s) => s.slide === currSlide)?.steps) ?? [];
        const nStep = currStep + 1;
        if (nStep < steps.length) await goto(currSlide, nStep);
        else await goto(currSlide + 1, 0);
    };

    const studentUrl = useMemo(() => {
        const origin = window.location.origin;
        const base = getBasePath();
        return `${origin}${base}/#/student?room=${roomCode}`;
    }, [roomCode]);

    const [history, setHistory] = useState<any[]>([]);
    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            const { data, error } = await rpc<any[]>("fetch_history_by_code", {
                p_room_code: roomCode, p_limit: 50
            });
            if (error) return;
            setHistory(data ?? []);
        })();
    }, [roomCode, state]);

    const currentStepMeta = (slidesMeta.find((s) => s.slide === currSlide)?.steps ?? [])[currStep];

    return (
        <div className="app-shell">
            <div className="topbar">
                <h1 style={{ margin: 0 }}>교사 제어 패널</h1>
                <span className="badge">권한: {isOwner ? "ON" : "OFF"}</span>
                <span className="badge">room: {roomCode}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
                {/* 좌측: 진행 영역 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="panel">
                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                            현재 교시: {currentDeckId ? "선택됨" : "미선택"} · 슬라이드 {currSlide} / 스텝 {currStep}
                        </div>
                        {currentStepMeta?.img ? (
                            <img src={currentStepMeta.img} alt="current" style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 8 }} />
                        ) : null}
                        <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn" onClick={next} disabled={!isOwner}>⏭ 다음</button>
                            <button className="btn" onClick={() => goto(currSlide, currStep)} disabled={!isOwner}>🔓 현재 스텝 해제</button>
                        </div>
                    </div>

                    <div className="panel">
                        <h3 style={{ marginTop: 0 }}>교시 전환(1~6)</h3>
                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
                            {slots.map((s) => (
                                <div key={s.slot} className="card" style={{ padding: 8, borderRadius: 10 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{s.slot}교시</div>
                                    <div style={{ fontSize: 12, opacity: 0.8, minHeight: 18 }}>
                                        {s.title || (s.deck_id ? s.deck_id.slice(0, 8) : "미배정")}
                                    </div>
                                    <button className="btn" style={{ marginTop: 6 }} onClick={() => selectPeriod(s.slot)} disabled={!isOwner}>
                                        전환
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
                                    <div key={idx} style={{ borderBottom: "1px solid rgba(148,163,184,0.12)", padding: "6px 0" }}>
                                        <div style={{ fontSize: 13 }}>
                                            <b>{h.student_id ?? "익명"}</b> → {h.answer_value ?? h.answer ?? ""}
                                        </div>
                                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                                            slide {h.slide} / step {h.step} · {h.created_at}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
