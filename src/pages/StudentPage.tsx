// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify } from "../hooks/useTeacherNotify";
import { loadSlides, type SlideMeta } from "../slideMeta"; // 👈 추가

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

    // 교사 → 학생 화면 동기화
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
            setAnswer("");
            setSubmitted(false);
        }
    }, [lastMessage]);

    // 슬라이드 JSON 불러오기
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    useEffect(() => {
        loadSlides().then(setSlides).catch(() => {
            // 실패해도 앱은 살아 있게
            setSlides([]);
        });
    }, []);

    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];

    const handleSubmit = () => {
        // JSON이 아직 안 불러와졌거나 이 스텝이 quiz가 아니면 무시
        if (!currentMeta || currentMeta.kind !== "quiz") return;
        const userAns = answer.trim();

        // 교사에게 알림
        sendToTeacher({
            type: "unlock-request",
            roomId,
            slide,
            step,
            answer: userAns,
            studentId,
        });

        // 자동채점
        const isCorrect =
            currentMeta.auto &&
            userAns.localeCompare(currentMeta.answer.trim(), undefined, {
                sensitivity: "base",
            }) === 0;

        setSubmitted(true);

        // isCorrect면 사실 여기서 뭔가 표시해도 되고, 우리는 교사가 최종 승인
    };

    const isQuiz = currentMeta?.kind === "quiz";

    return (
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <h2>학생 화면</h2>
            <p>room: {roomId}</p>
            <p>내 ID: {studentId}</p>
            <p>연결: {connected ? "🟢" : "⚪️"}</p>
            <div
                style={{
                    background: "#0f172a",
                    padding: 12,
                    borderRadius: 12,
                    marginBottom: 16,
                }}
            >
                <div style={{ fontSize: 12, opacity: 0.7 }}>현재 문제</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                    슬라이드 {slide} / 스텝 {step}{" "}
                    {isQuiz ? <span style={{ color: "#f97316" }}>(문제)</span> : <span>(설명)</span>}
                </div>
            </div>

            {isQuiz ? (
                <div>
                    <p>정답을 입력하면 선생님께 전송됩니다.</p>
                    <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        disabled={submitted}
                        style={{
                            width: "100%",
                            padding: 8,
                            marginBottom: 8,
                            background: submitted ? "#1f2937" : "white",
                            color: submitted ? "#94a3b8" : "black",
                        }}
                        placeholder="정답 입력"
                    />
                    <button onClick={handleSubmit} disabled={submitted}>
                        {submitted ? "제출됨 (선생님 확인 중)" : "제출"}
                    </button>
                </div>
            ) : (
                <div
                    style={{
                        background: "#fee2e2",
                        color: "#b91c1c",
                        padding: 10,
                        borderRadius: 8,
                    }}
                >
                    교사가 아직 이 스텝을 열지 않았습니다. 잠시 기다려 주세요.
                </div>
            )}
        </div>
    );
}
