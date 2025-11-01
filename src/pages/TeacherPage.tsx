// src/pages/TeacherPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify, type TeacherEvent } from "../hooks/useTeacherNotify";
import { loadSlides, type SlideMeta } from "../slideMeta"; // 👈 추가
import { supabase } from "../supabaseClient";

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
    const [queue, setQueue] = useState<TeacherEvent[]>([]);
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [history, setHistory] = useState<
        { id: number; studentId?: string; answer: string; slide: number; step: number; created_at?: string }[]
    >([]);

    // 슬라이드 JSON 로드
    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];

    // 학생 요청 받기 + Supabase에 기록
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setQueue((prev) => [...prev, lastEvent]);

            // supabase에 로그 남기기 (answers 테이블 있어야 함)
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
                    // 테이블 아직 안 만들어졌으면 여기서만 조용히 무시
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
    }, [lastEvent, roomId]);

    // 다른 교사 탭에서 온 goto도 반영
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

    // 다음 스텝으로
    const handleNext = () => {
        const steps = currentSlide?.steps ?? [];
        const nextStep = step + 1;
        if (nextStep < steps.length) {
            goTo(slide, nextStep);
        } else {
            // 다음 슬라이드
            goTo(slide + 1, 0);
        }
        setQueue([]);
    };

    // 이 스텝만 다시 열기
    const handleUnlockOnly = () => {
        send({ type: "goto", slide, step });
        setQueue([]);
    };

    // 방 코드 새로 만들기 + 학생 URL 복사
    const handleNewRoom = () => {
        const code = makeRoomCode();
        nav(`/teacher?room=${code}`);
        if (navigator.clipboard) {
            // ⚠️ 여기 경로는 GitHub Pages 기준으로 맞춰야 함
            const studentUrl = `${window.location.origin}/AUTOPPT/student?room=${code}`;
            navigator.clipboard.writeText(studentUrl).catch(() => {});
        }
    };

    // 기존 기록 읽기
    useEffect(() => {
        supabase
            .from("answers")
            .select("*")
            .eq("room_id", roomId)
            .order("created_at", { ascending: false })
            .limit(30)
            .then(({ data, error }) => {
                if (error || !data) return;
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
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1.2fr 0.8fr" }}>
            <div>
                <header style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
                    <h2 style={{ fontSize: 22, margin: 0 }}>교사 화면</h2>
                    <button onClick={handleNewRoom} style={{ padding: "4px 10px" }}>
                        방 코드 새로 만들기
                    </button>
                    <span style={{ fontSize: 12 }}>
            실시간: {connected ? "🟢" : "⚪️"} / 학생: {tConnected ? "🟢" : "⚪️"}
          </span>
                </header>

                <div
                    style={{
                        background: "#0f172a",
                        padding: 16,
                        borderRadius: 12,
                        marginBottom: 16,
                    }}
                >
                    <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>현재 문제</div>
                    <div style={{ fontSize: 26, fontWeight: 700 }}>
                        슬라이드 {slide} / 스텝 {step}{" "}
                        {currentMeta?.kind === "quiz" ? <span style={{ color: "#f97316" }}>(문제)</span> : null}
                    </div>

                    {/* 슬라이드 이미지가 있으면 보여주기 */}
                    {currentMeta?.img ? (
                        <img
                            src={currentMeta.img}
                            alt={`slide ${slide}-${step}`}
                            style={{ marginTop: 10, maxWidth: "100%", borderRadius: 8 }}
                        />
                    ) : null}

                    <div style={{ marginTop: 8 }}>
                        <button onClick={handleNext} style={{ marginRight: 8 }}>
                            ⏭ 다음 스텝으로 보내기
                        </button>
                        <button onClick={handleUnlockOnly}>🔓 이 스텝만 다시 열기</button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>room: {roomId}</div>
                </div>

                <div>
                    <h3 style={{ marginBottom: 8 }}>해제 요청 대기열</h3>
                    {queue.length === 0 ? (
                        <p style={{ opacity: 0.7 }}>대기 중인 학생 없음</p>
                    ) : (
                        queue.map((evt, idx) => (
                            <div
                                key={idx}
                                style={{
                                    background: "#1e293b",
                                    marginBottom: 8,
                                    padding: 10,
                                    borderRadius: 10,
                                }}
                            >
                                <div>
                                    <b>{evt.studentId ?? "익명 학생"}</b> 가 제출했습니다.
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>
                                    슬라이드 {evt.slide} / 스텝 {evt.step}
                                </div>
                                <div style={{ marginTop: 4, background: "#0f172a", padding: 6, borderRadius: 6 }}>
                                    답: {evt.answer || "(빈값)"}
                                </div>
                                <div style={{ marginTop: 6 }}>
                                    <button onClick={handleNext} style={{ marginRight: 6 }}>
                                        ⏭ 이 학생 승인하고 다음으로
                                    </button>
                                    <button onClick={handleUnlockOnly}>🔓 이 스텝만 다시 열기</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div>
                <h3>최근 제출 기록</h3>
                <div
                    style={{
                        maxHeight: 320,
                        overflowY: "auto",
                        border: "1px solid #1f2937",
                        borderRadius: 8,
                        padding: 8,
                    }}
                >
                    {history.length === 0 ? (
                        <p style={{ opacity: 0.6 }}>기록 없음</p>
                    ) : (
                        history.map((h) => (
                            <div key={h.id} style={{ borderBottom: "1px solid #1f2937", padding: "6px 0" }}>
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
    );
}
