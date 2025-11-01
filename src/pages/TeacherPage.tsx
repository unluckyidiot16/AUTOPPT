// src/pages/TeacherPage.tsx
import React, { useEffect, useState } from "react";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useTeacherNotify, type TeacherEvent } from "../hooks/useTeacherNotify";
import { SLIDE_META } from "../slideMeta";

export default function TeacherPage() {
    const roomId = useRoomId("class-1");
    const { connected, lastMessage, send } = useRealtime(roomId, "teacher");
    const { connected: tConnected, lastEvent } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [queue, setQueue] = useState<TeacherEvent[]>([]);

    // 학생들이 보낸 요청 수신
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setQueue((prev) => [...prev, lastEvent]);
        }
    }, [lastEvent]);

    // 교사도 다른 교사(혹은 자기) 신호 받아서 화면 맞추기
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            setSlide(lastMessage.slide);
            setStep(lastMessage.step);
        }
    }, [lastMessage]);

    const currentMeta = SLIDE_META[slide]?.steps?.[step];

    const goTo = (nextSlide: number, nextStep: number) => {
        // 본인 화면
        setSlide(nextSlide);
        setStep(nextStep);
        // 전체에게 방송
        send({ type: "goto", slide: nextSlide, step: nextStep });
    };

    // 다음 스텝으로 진행
    const handleNext = () => {
        const steps = SLIDE_META[slide]?.steps || [];
        const nextStep = step + 1;
        if (nextStep < steps.length) {
            goTo(slide, nextStep);
        } else {
            // 다음 슬라이드로 넘어가고 step=0
            goTo(slide + 1, 0);
        }
        // 승인 후 큐 비우기
        setQueue([]);
    };

    return (
        <div style={{ display: "grid", gap: 16 }}>
            <div>
                <h2>교사 화면</h2>
                <p>room: {roomId}</p>
                <p>
                    실시간: {connected ? "🟢" : "⚪️"} / 학생알림: {tConnected ? "🟢" : "⚪️"}
                </p>
                <p>
                    현재 슬라이드: {slide} / 스텝: {step}{" "}
                    {currentMeta?.kind === "quiz" ? "(문제 스텝)" : ""}
                </p>
                <button onClick={handleNext}>다음으로 보내기</button>
            </div>

            <div>
                <h3>해제 요청 대기열</h3>
                {queue.length === 0 && <p>대기 중인 학생 없음</p>}
                {queue.map((evt, idx) => (
                    <div
                        key={idx}
                        style={{
                            border: "1px solid #334155",
                            borderRadius: 8,
                            padding: 8,
                            marginBottom: 8,
                        }}
                    >
                        <p>
                            학생: {evt.studentId ?? "unknown"} / 입력: <b>{evt.answer}</b>
                        </p>
                        <p>
                            슬라이드 {evt.slide} / 스텝 {evt.step}
                        </p>
                        <button onClick={handleNext}>이 학생 승인하고 다음으로</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
