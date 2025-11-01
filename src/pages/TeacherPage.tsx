// src/pages/TeacherPage.tsx (교체/수정 포인트만)
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
    const roomId = useRoomId("class-1"); // ex) KAK9GP

    const { connected, lastMessage, send } = useRealtime(roomId, "teacher");
    const { connected: tConnected, lastEvent } = useTeacherNotify(roomId);

    const [slide, setSlide] = useState(1);
    const [step, setStep] = useState(0);
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [queue, setQueue] = useState<TeacherEvent[]>([]);
    const [history, setHistory] = useState<
        { id: number; studentId?: string; answer: string; slide: number; step: number; created_at?: string }[]
    >([]);

    // ✅ 학생 접속 URL: 현재 roomId(텍스트 코드) 기준
    const studentUrl = useMemo(() => {
        const origin = window.location.origin;
        const base = getBasePath(); // "/AUTOPPT"
        return `${origin}${base}/#/student?room=${roomId}`;
    }, [roomId]);

    // ✅ 새 반: 코드만 만들고 쿼리스트링 갱신(rooms 미사용)
    const handleNewRoom = () => {
        const code = makeRoomCode();
        nav(`/teacher?room=${code}`);
        const origin = window.location.origin;
        const base = getBasePath();
        const stuUrl = `${origin}${base}/#/student?room=${code}`;
        navigator.clipboard?.writeText(stuUrl).catch(() => {});
    };

    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];

    // 학생 요청 수신 + UI 큐 반영(answers insert는 학생 RPC가 수행)
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === "unlock-request") {
            setQueue((prev) => [...prev, lastEvent]);
        }
    }, [lastEvent]);

    // 교사 간 sync
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

    // ✅ 최근 제출 로딩: answers.room_code = roomId
    useEffect(() => {
        supabase
            .from("answers")
            .select("*")
            .eq("room_code", roomId)
            .order("created_at", { ascending: false })
            .limit(30)
            .then(({ data, error }) => {
                if (error) { console.error(error); return; }
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

    // ... 이하 렌더는 기존 그대로 ...
}
