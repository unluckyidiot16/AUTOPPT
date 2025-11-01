import React, { useState, useEffect } from "react";
import ConnectionStatus from "../components/ConnectionStatus";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify } from "../hooks/useTeacherNotify";
import type { TeacherEvent } from "../hooks/useTeacherNotify";

const DUMMY_SLIDES = [1, 2, 3, 4];

export default function TeacherPage() {
    const roomId = "class-1";

    // 메인 채널: 슬라이드/스텝 브로드캐스트
    const { connected, lastMessage, send } = useRealtime(roomId, "teacher");

    // 교사용 채널: 학생들이 보낸 unlock 요청
    const {
        connected: teacherChanConnected,
        lastEvent,
    } = useTeacherNotify(roomId);

    const [currentSlide, setCurrentSlide] = useState(1);
    const [currentStep, setCurrentStep] = useState(0);
    const [pending, setPending] = useState<TeacherEvent[]>([]);

    // 학생이 뭔가 보냈을 때 대기열에 쌓기
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setPending((prev) => [...prev, lastEvent]);
        }
    }, [lastEvent]);

    const gotoSlide = (slide: number) => {
        setCurrentSlide(slide);
        setCurrentStep(0);
        send({ type: "goto", slide, step: 0 });
    };

    const nextStep = () => {
        const next = currentStep + 1;
        setCurrentStep(next);
        send({ type: "goto", slide: currentSlide, step: next });
        // 같은 슬라이드/스텝에 대한 요청은 이제 필요 없으니까 비워도 됨
        setPending([]);
    };

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: 12 }}>교사 화면</h2>
            <ConnectionStatus connected={connected} />
            <p>메인 채널: {connected ? "OK" : "X"} / 교사용 채널: {teacherChanConnected ? "OK" : "X"}</p>

            <p style={{ marginTop: 8 }}>
                현재 슬라이드: {currentSlide}, 스텝: {currentStep}
            </p>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {DUMMY_SLIDES.map((s) => (
                    <button key={s} onClick={() => gotoSlide(s)}>
                        슬라이드 {s}
                    </button>
                ))}
            </div>

            <button onClick={nextStep} style={{ marginTop: 16 }}>
                다음 스텝으로 전체 보내기
            </button>

            <div style={{ marginTop: 24 }}>
                <h3>학생 요청 대기열</h3>
                {pending.length === 0 && <p>아직 도착한 정답이 없습니다.</p>}
                {pending.map((evt, idx) => (
                    <div
                        key={idx}
                        style={{
                            marginTop: 8,
                            padding: 8,
                            background: "#1f2937",
                            borderRadius: 6,
                        }}
                    >
                        <div>
                            slide {evt.slide} / step {evt.step}
                        </div>
                        <div>answer: {evt.answer}</div>
                        <div>student: {evt.studentId ?? "익명"}</div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 16 }}>
                <small>마지막 수신: {lastMessage ? JSON.stringify(lastMessage) : "없음"}</small>
            </div>
        </div>
    );
}
