// src/pages/StudentPage.tsx
import React, { useEffect, useState } from "react";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify } from "../hooks/useTeacherNotify";
import { SLIDE_META } from "../slideMeta";

export default function StudentPage() {
    const roomId = useRoomId("class-1");
    const { connected, lastMessage } = useRealtime(roomId, "student");
    const { send: sendToTeacher } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [answer, setAnswer] = useState("");
    const [submitted, setSubmitted] = useState(false);

    // 교사 → 학생으로 온 화면 넘기기
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
            setAnswer("");
            setSubmitted(false);
        }
    }, [lastMessage]);

    // 현재 스텝 메타
    const currentMeta = SLIDE_META[slide]?.steps?.[step];

    // 학생이 정답 제출하기
    const handleSubmit = () => {
        if (!currentMeta || currentMeta.kind !== "quiz") return;

        const userAns = answer.trim();
        const corr = currentMeta.answer.trim();

        // 자동채점
        const isCorrect =
            currentMeta.auto &&
            userAns.localeCompare(corr, undefined, { sensitivity: "base" }) === 0;

        // 교사에게 알림
        sendToTeacher({
            type: "unlock-request",
            roomId,
            slide,
            step,
            answer: userAns,
            studentId: "student-" + Math.random().toString(36).slice(2, 6),
        });

        // 자동 정답이면 학생 쪽에서는 바로 “제출함” 표시
        if (isCorrect) {
            setSubmitted(true);
        } else {
            // 틀렸어도 제출은 했음
            setSubmitted(true);
        }
    };

    return (
        <div style={{ maxWidth: 480 }}>
            <h2>학생 화면</h2>
            <p>room: {roomId}</p>
            <p>연결: {connected ? "🟢" : "⚪️"}</p>
            <p>
                현재 슬라이드: {slide} / 스텝: {step}
            </p>

            {currentMeta?.kind === "quiz" ? (
                <div style={{ marginTop: 16 }}>
                    <p>이 스텝은 문제입니다. 정답을 입력하면 교사에게 전송됩니다.</p>
                    <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        disabled={submitted}
                        placeholder="정답 입력"
                        style={{ width: "100%", padding: 8, marginBottom: 8 }}
                    />
                    <button onClick={handleSubmit} disabled={submitted}>
                        {submitted ? "제출됨" : "제출"}
                    </button>
                </div>
            ) : (
                <p>교사가 설명 중입니다…</p>
            )}
        </div>
    );
}
