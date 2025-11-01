// src/pages/TeacherPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify, type TeacherEvent } from "../hooks/useTeacherNotify";
import { loadSlides, type SlideMeta } from "../slideMeta";
import { supabase } from "../supabaseClient";
import { RoomQR } from "../components/RoomQR";

function makeRoomCode(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export default function TeacherPage() {
    const nav = useNavigate();
    const roomId = useRoomId("class-1");
    const { connected, lastMessage, send } = useRealtime(roomId, "teacher");
    const { connected: tConnected, lastEvent } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [queue, setQueue] = useState<TeacherEvent[]>([]);
    const [history, setHistory] = useState<
        { id: number; studentId?: string; answer: string; slide: number; step: number; created_at?: string }[]
    >([]);

    // 현재 room 기준 학생 접속 URL
    const studentUrl = useMemo(() => {
        // ⚠️ GitHub Pages 경로 맞춰서
        const base = window.location.origin;
        // 예: https://user.github.io/AUTOPPT
        const prefix = base.includes("github.io") ? `${base}/AUTOPPT` : base;
        return `${prefix}/student?room=${roomId}`;
    }, [roomId]);

    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];

    // 학생 요청 수신 + 로그 저장
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setQueue((prev) => [...prev, lastEvent]);

            supabase
                .from("answers")
                .insert({
                    room_id: lastEvent.roomId,
                    slide: lastEvent.slide,
                    step: lastEvent.step,
                    student_id: lastEvent.studentId ?? null,
                    answer: lastEvent.answer,
                })
                .then(({ error }) => {
                    if (!error) {
                        setHistory((prev) => [
                            {
                                id: Date.now(),
                                studentId: lastEvent.studentId,
                                answer: lastEvent.answer,
                                slide: lastEvent.slide,
                                step: lastEvent.step,
                            },
                            ...prev,
                        ]);
                    }
                });
        }
    }, [lastEvent]);

    // 다른 교사 탭에서 온 sync
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
        }
    }, [lastMessage]);

    const goTo = (nextSlide: number, nextStep: number) => {
        setSlide(nextSlide);
        setStep(nextStep);
        send({ type: "goto", slide: nextSlide, step: nextStep });
    };

    const handleNext = () => {
        const steps = currentSlide?.steps ?? [];
        const nextStep = step + 1;
        if (nextStep < steps.length) {
            goTo(slide, nextStep);
        } else {
            goTo(slide + 1, 0);
        }
        setQueue([]);
    };

    const handleUnlockOnly = () => {
        send({ type: "goto", slide, step });
        setQueue([]);
    };

    const handleNewRoom = () => {
        const code = makeRoomCode();
        nav(`/teacher?room=${code}`);
        // 클립보드에 학생용 URL
        const base = window.location.origin;
        const prefix = base.includes("github.io") ? `${base}/AUTOPPT` : base;
        const stuUrl = `${prefix}/student?room=${code}`;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(stuUrl).catch(() => {});
        }
    };

    // 과거 기록 로딩
    useEffect(() => {
        supabase
            .from("answers")
            .select("*")
            .eq("room_id", roomId)
            .order("created_at", { ascending: false })
            .limit(30)
            .then(({ data }) => {
                if (!data) return;
                setHistory(
                    data.map((row: any, idx: number) => ({
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

    return (
        <div className="app-shell">
            <div className="topbar">
                <h1 style={{ fontSize: 20, margin: 0 }}>교사 제어 패널</h1>
                <button className="btn" onClick={handleNewRoom}>
                    + 반(ROOM) 만들기
                </button>
                <span className="badge">sync: {connected ? "🟢" : "⚪️"}</span>
                <span className="badge">student: {tConnected ? "🟢" : "⚪️"}</span>
                <span className="badge">room: {roomId}</span>
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
                            <img
                                src={currentMeta.img}
                                alt="current"
                                style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 10 }}
                            />
                        ) : null}
                        <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn" onClick={handleNext}>
                                ⏭ 다음 스텝으로 보내기
                            </button>
                            <button className="btn" onClick={handleUnlockOnly}>
                                🔓 이 스텝만 다시 열기
                            </button>
                        </div>
                    </div>

                    <div className="panel">
                        <h3 style={{ marginTop: 0, marginBottom: 10 }}>해제 요청 대기열</h3>
                        {queue.length === 0 ? (
                            <p style={{ opacity: 0.6 }}>대기 중인 학생 없음</p>
                        ) : (
                            queue.map((evt, idx) => (
                                <div key={idx} className="queue-item">
                                    <div>
                                        <b>{evt.studentId ?? "익명 학생"}</b> 가 제출했습니다.
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                                        슬라이드 {evt.slide} / 스텝 {evt.step}
                                    </div>
                                    <div
                                        style={{
                                            marginTop: 6,
                                            background: "rgba(15,23,42,0.25)",
                                            borderRadius: 8,
                                            padding: "4px 8px",
                                        }}
                                    >
                                        답안: {evt.answer || "(빈값)"}
                                    </div>
                                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                                        <button className="btn" onClick={handleNext}>
                                            ⏭ 승인 후 다음
                                        </button>
                                        <button className="btn" onClick={handleUnlockOnly}>
                                            🔓 이 스텝만
                                        </button>
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
