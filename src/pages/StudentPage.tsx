import React, { useEffect, useState } from "react";
import ConnectionStatus from "../components/ConnectionStatus";
import SlideViewer from "../components/SlideViewer";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify } from "../hooks/useTeacherNotify";
import { SLIDE_META } from "../slideMeta";

export default function StudentPage() {
    const roomId = "class-1";
    // 메인 채널: 슬라이드/스텝 받기
    const { connected, lastMessage } = useRealtime(roomId, "student");
    // 교사용 채널로 이벤트 보내기
    const { send: notifyTeacher } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [answerInput, setAnswerInput] = useState("");

    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
            setAnswerInput(""); // 슬라이드 바뀌면 입력 초기화
        }
    }, [lastMessage]);

    // 지금 step이 퀴즈인지 판별
    const currentMeta = SLIDE_META[slide];
    const stepMeta = currentMeta?.steps[step];

    const isQuiz = stepMeta?.kind === "quiz";

    const handleSubmit = () => {
        if (!isQuiz) return;
        notifyTeacher({
            type: "unlock-request",
            roomId,
            slide,
            step,
            answer: answerInput,
            // studentId는 로그인 붙이면 여기 넣으면 됨
        });
        // 학생 입장에서는 “보냈다”만 표시
        alert("교사에게 제출되었어요. 다음 단계로 넘어가길 기다리세요.");
    };

    return (
        <div>
            <h2>학생 화면</h2>
            <ConnectionStatus connected={connected} />
            <p>
                지금 보는 슬라이드: {slide} / step {step}
            </p>
            <SlideViewer slide={slide} step={step} />

            {isQuiz && (
                <div style={{ marginTop: 16 }}>
                    <p>이 단계는 교사가 내는 문제예요. 정답을 입력하세요.</p>
                    <input
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        placeholder="정답 입력"
                        style={{ padding: 6, minWidth: 240 }}
                    />
                    <button onClick={handleSubmit} style={{ marginLeft: 8, padding: "6px 10px" }}>
                        제출
                    </button>
                </div>
            )}
        </div>
    );
}
