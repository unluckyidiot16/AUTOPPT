// src/pages/TeacherPage.tsx
import React, { useRef, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify, type TeacherEvent } from "../hooks/useTeacherNotify";
import { loadSlides, type SlideMeta } from "../slideMeta";
import { supabase } from "../supabaseClient";
import { RoomQR } from "../components/RoomQR";
import { getBasePath } from "../utils/getBasePath";

function makeRoomCode(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export default function TeacherPage() {
    const nav = useNavigate();
    const defaultCode = useMemo(() => "CLASS-" + makeRoomCode(), []);
    const roomId = useRoomId(defaultCode); 
    const { connected, lastMessage, send } = useRealtime(roomId, "teacher");
    const { connected: tConnected, lastEvent } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [queue, setQueue] = useState<TeacherEvent[]>([]);
    const [history, setHistory] = useState<
        { id: number; studentId?: string; answer: string; slide: number; step: number; created_at?: string }[]
    >([]);
    const [isOwner, setIsOwner] = useState(false);

    const studentUrl = useMemo(() => {
        const origin = window.location.origin;
        const base = getBasePath();
        return `${origin}${base}/#/student?room=${roomId}`;
    }, [roomId]);

    const claimedRef = useRef<string | null>(null);
    
    // 세션 보장 + 점유
    useEffect(() => {
        let cancelled = false;
        if (claimedRef.current === roomId) return; // 같은 room에 대해 재실행 방지
        claimedRef.current = roomId;
        
        async function ensureAndClaim(code: string, attempt = 0): Promise<void> {
            if (cancelled) return;
            await supabase.rpc("ensure_session", { p_room_code: code });

            const { data, error } = await supabase.rpc("claim_session_auth", { p_room_code: code });
            if (cancelled) return;

            if (error) {
                console.error("[claim_session_auth] error:", error);
                setIsOwner(false);
                return;
            }

            if (data === true) {
                setIsOwner(true);
            } else {
                // 이미 다른 교사가 점유 중 → 새 코드로 분기
                if (attempt >= 2) {
                    setIsOwner(false); // 읽기 전용
                    return;
                }
                const next = makeRoomCode();
                await supabase.rpc("ensure_session", { p_room_code: next });
                nav(`/teacher?room=${next}`, { replace: true });
            }
        }

        ensureAndClaim(roomId, 0);

        const hb = setInterval(() => {
            supabase.rpc("heartbeat_session_auth", { p_room_code: roomId });
        }, 30_000);

        const onBye = () => {
            supabase.rpc("release_session_auth", { p_room_code: roomId });
        };
        window.addEventListener("beforeunload", onBye);

        return () => {
            cancelled = true;
            clearInterval(hb);
            window.removeEventListener("beforeunload", onBye);
        };
    }, [roomId, nav]);

    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    // 학생 해제 요청 → 대기열
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setQueue((prev) => [...prev, lastEvent]);
        }
    }, [lastEvent]);

    // 다른 교사/탭에서의 동기 신호 수신
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
        }
    }, [lastMessage]);

    const loc = useLocation();
    useEffect(() => {
        const hasRoom = new URLSearchParams(loc.search).has("room");
        if (!hasRoom && roomId) {
            // 첫 진입 시 한 번만 URL에 고정
            nav(`/teacher?room=${roomId}`, { replace: true });
        }
        }, [loc.search, nav, roomId]);
    
    const goTo = (nextSlide: number, nextStep: number) => {
        setSlide(nextSlide);
        setStep(nextStep);
        send({ type: "goto", slide: nextSlide, step: nextStep });
    };

    const handleNext = () => {
        if (!isOwner) return;
        const steps = (slides.find((s) => s.slide === slide)?.steps) ?? [];
        const nextStep = step + 1;
        if (nextStep < steps.length) goTo(slide, nextStep);
        else goTo(slide + 1, 0);
        setQueue([]);
    };

    const handleUnlockOnly = () => {
        if (!isOwner) return;
        send({ type: "goto", slide, step });
        setQueue([]);
    };

    // 새 반 만들기도 auth 기반 claim
    const handleNewRoom = async () => {
        const code = makeRoomCode();
        await supabase.rpc("ensure_session", { p_room_code: code });
        const { data } = await supabase.rpc("claim_session_auth", { p_room_code: code });
        if (data !== true) return;
        nav(`/teacher?room=${code}`);
        const origin = window.location.origin;
        const base = getBasePath();
        const stuUrl = `${origin}${base}/#/student?room=${code}`;
        navigator.clipboard?.writeText(stuUrl).catch(() => {});
    };

    // 최근 제출
    useEffect(() => {
        supabase
            .from("answers")
            .select("*")
            .eq("room_code", roomId)
            .order("created_at", { ascending: false })
            .limit(30)
            .then(({ data, error }) => {
                if (error) return console.error(error);
                setHistory(
                    (data ?? []).map((row: any, idx: number) => ({
                        id: row.id ?? idx,
                        studentId: row.student_id ?? undefined,
                        answer: row.answer,
                        slide: row.slide,
                        step: row.step,
                        created_at: row.created_at,
                    }))
                );
            });
    }, [roomId]);

    const currentMeta = (slides.find((s) => s.slide === slide)?.steps ?? [])[step];

    return (
        <div className="app-shell">
            <div className="topbar">
                <h1 style={{ fontSize: 20, margin: 0 }}>교사 제어 패널</h1>
                <span className="badge">권한: {isOwner ? "ON" : "OFF"}</span>
                <span className="badge">sync: {connected ? "🟢" : "⚪️"}</span>
                <span className="badge">student: {tConnected ? "🟢" : "⚪️"}</span>
                <span className="badge">room: {roomId}</span>
                <button className="btn" onClick={handleNewRoom}>+ 새 반</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
                {/* 왼쪽: 현재 문제 + 대기열 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="panel">
                        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>현재 문제</div>
                        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>
                            슬라이드 {slide} / 스텝 {step}{" "}
                            {currentMeta?.kind === "quiz" ? <span style={{ color: "#f97316" }}>(문제)</span> : null}
                        </div>
                        {currentMeta?.img ? (
                            <img src={currentMeta.img} alt="current" style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 10 }} />
                        ) : null}
                        <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn" onClick={handleNext} disabled={!isOwner}>⏭ 다음 스텝</button>
                            <button className="btn" onClick={handleUnlockOnly} disabled={!isOwner}>🔓 현재 스텝 해제</button>
                        </div>
                    </div>

                    <div className="panel">
                        <h3 style={{ marginTop: 0, marginBottom: 10 }}>해제 요청 대기열</h3>
                        {queue.length === 0 ? (
                            <p style={{ opacity: 0.6 }}>대기 중인 학생 없음</p>
                        ) : (
                            queue.map((evt, idx) => (
                                <div key={idx} className="queue-item">
                                    <div><b>{evt.studentId ?? "익명 학생"}</b> 가 제출</div>
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>슬라이드 {evt.slide} / 스텝 {evt.step}</div>
                                    <div style={{ marginTop: 6, background: "rgba(15,23,42,0.25)", borderRadius: 8, padding: "4px 8px" }}>
                                        답안: {evt.answer || "(빈값)"}
                                    </div>
                                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                                        <button className="btn" onClick={handleNext} disabled={!isOwner}>⏭ 승인 후 다음</button>
                                        <button className="btn" onClick={handleUnlockOnly} disabled={!isOwner}>🔓 이 스텝만</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 오른쪽: QR + 기록 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <RoomQR url={studentUrl} />
                    <div className="panel">
                        <h3 style={{ marginTop: 0, marginBottom: 8 }}>최근 제출 기록</h3>
                        <div style={{ maxHeight: 240, overflowY: "auto" }}>
                            {history.length === 0 ? (
                                <p style={{ opacity: 0.6 }}>기록 없음</p>
                            ) : (
                                history.map((h) => (
                                    <div key={h.id} style={{ borderBottom: "1px solid rgba(148,163,184,0.12)", padding: "5px 0" }}>
                                        <div style={{ fontSize: 13 }}>
                                            <b>{h.studentId ?? "익명"}</b> → {h.answer}
                                        </div>
                                        <div style={{ fontSize: 11, opacity: 0.6 }}>
                                            slide {h.slide} / step {h.step} {h.created_at ? "· " + h.created_at : ""}
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
