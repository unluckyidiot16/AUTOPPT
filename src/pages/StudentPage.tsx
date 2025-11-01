// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify } from "../hooks/useTeacherNotify";
import { loadSlides, type SlideMeta } from "../slideMeta";

function makeStudentId() {
    return "stu-" + Math.random().toString(36).slice(2, 7);
}

export default function StudentPage() {
    const roomId = useRoomId("class-1");
    const { connected, lastMessage } = useRealtime(roomId, "student");
    const { send: sendToTeacher } = useTeacherNotify(roomId);

    const studentId = useMemo(() => makeStudentId(), []);
    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [answer, setAnswer] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [slides, setSlides] = useState<SlideMeta[]>([]);

    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
            setAnswer("");
            setSubmitted(false);
        }
    }, [lastMessage]);

    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];
    const isQuiz = currentMeta?.kind === "quiz";

    const handleSubmit = () => {
        if (!isQuiz) return;
        const userAns = answer.trim();
        sendToTeacher({
            type: "unlock-request",
            roomId,
            slide,
            step,
            answer: userAns,
            studentId,
        });
        setSubmitted(true);
    };

    return (
        <div className="app-shell" style={{ maxWidth: 520 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge">room: {roomId}</span>
                <span className="badge">내 ID: {studentId}</span>
                <span className="badge">연결: {connected ? "🟢" : "⚪️"}</span>
            </div>

            <div className="panel" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>현재 문제</div>
                <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
                    슬라이드 {slide} / 스텝 {step}{" "}
                    {isQuiz ? <span style={{ color: "#f97316" }}>(문제)</span> : <span>(설명)</span>}
                </div>
                {currentMeta?.img ? (
                    <img
                        src={currentMeta.img}
                        alt="slide"
                        style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 4 }}
                    />
                ) : null}
            </div>

            {isQuiz ? (
                <div className="panel">
                    <p style={{ marginTop: 0, marginBottom: 8 }}>정답을 입력하면 선생님께 전송됩니다.</p>
                    <input
                        className="input"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="정답 입력"
                        disabled={submitted}
                    />
                    <button className="btn" onClick={handleSubmit} disabled={submitted} style={{ marginTop: 10 }}>
                        {submitted ? "제출됨 (선생님 확인 중)" : "제출"}
                    </button>
                </div>
            ) : (
                <div className="lock-banner">교사가 아직 이 스텝을 열지 않았습니다. 잠시 기다려 주세요.</div>
            )}
        </div>
    );
}
