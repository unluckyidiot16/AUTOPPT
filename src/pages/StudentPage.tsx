import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { loadSlides, type SlideMeta } from "../slideMeta";

// --- AUTOPPT minimal debug helpers ---
const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
    time(label: string) {
        if (!DEBUG) return () => {};
        console.time(`[AUTOPPT] ${label}`);
        return () => console.timeEnd(`[AUTOPPT] ${label}`);
    },
};

// supabase RPC 공통 래퍼 (성공/실패/소요시간 로깅)
async function rpc<T = any>(name: string, params: Record<string, any>) {
    const stop = DBG.time(`rpc:${name}`);
    DBG.info("rpc →", name, params);
    const { data, error } = await supabase.rpc(name, params);
    stop();
    if (error) DBG.err("rpc ←", name, error);
    else DBG.ok("rpc ←", name, data);
    return { data: data as T | null, error };
}

// 브라우저 콘솔에서 즉석 디버깅 가능하게 노출(선택)
if (typeof window !== "undefined") {
    // @ts-ignore
    (window).sb = supabase;
}

function makeStudentId() {
    return "stu-" + Math.random().toString(36).slice(2, 7);
}

export default function StudentPage() {
    const roomCode = useRoomId("CLASS-XXXXXX");
    const studentId = useMemo(() => makeStudentId(), []);
    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [state, setState] = useState<{ slide?: number; step?: number }>({});
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);
    const [answer, setAnswer] = useState("");
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        DBG.info("StudentPage mount", { room: roomCode, studentId });
    }, [roomCode, studentId]);

    useEffect(() => {
        loadSlides().then(setSlides).catch(() => setSlides([]));
    }, []);

    // rooms(state/current_deck_id) 구독
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode) return;
            const { data, error } = await supabase
                .from("rooms")
                .select("current_deck_id, state")
                .eq("code", roomCode)
                .maybeSingle();

            if (!cancelled && !error && data) {
                setCurrentDeckId(data.current_deck_id ?? null);
                setState((data.state as any) ?? {});
            }

            const channel = supabase
                .channel(`rooms:${roomCode}`)
                .on(
                    "postgres_changes",
                    { event: "UPDATE", schema: "public", table: "rooms", filter: `code=eq.${roomCode}` },
                    (payload) => {
                        const row: any = payload.new;
                        setCurrentDeckId(row.current_deck_id ?? null);
                        setState(row.state ?? {});
                        setSubmitted(false);
                        setAnswer("");
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        })();

        return () => {
            cancelled = true;
        };
    }, [roomCode]);

    const slide = Number(state?.slide ?? 1);
    const step  = Number(state?.step  ?? 0);
    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];
    const isQuiz = currentMeta?.kind === "quiz";

    const handleSubmit = async () => {
        if (!isQuiz) return;
        const userAns = answer.trim();
        const payload = {
            p_room_code: roomCode,
            p_slide: slide,
            p_step: step,
            p_student_id: studentId,
            p_answer: userAns,
        };
        DBG.info("answer.submit click", payload);

        const { error } = await rpc("submit_answer_v2", payload);
        if (error) return;
        setSubmitted(true);
    };

    return (
        <div className="app-shell" style={{ maxWidth: 560 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">내 ID: {studentId}</span>
                <span className="badge">교시: {currentDeckId ? "선택됨" : "미선택"}</span>
            </div>

            {!currentDeckId ? (
                <div className="panel">수업이 아직 시작되지 않았습니다. 조금만 기다려 주세요.</div>
            ) : (
                <>
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
                                {submitted ? "제출됨" : "제출"}
                            </button>
                        </div>
                    ) : (
                        <div className="lock-banner">교사가 아직 이 스텝을 열지 않았습니다. 잠시 기다려 주세요.</div>
                    )}
                </>
            )}
        </div>
    );
}
