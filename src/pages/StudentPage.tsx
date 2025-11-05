import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { loadSlides, type SlideMeta } from "../slideMeta";
import PdfViewer from "../components/PdfViewer";


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


async function rpc<T = any>(name: string, params: Record<string, any>) {
    const stop = DBG.time(`rpc:${name}`);
    DBG.info("rpc →", name, params);
    const { data, error } = await supabase.rpc(name, params);
    stop();
    if (error) DBG.err("rpc ←", name, error);
    else DBG.ok("rpc ←", name, data);
    return { data: data as T | null, error };
}

if (typeof window !== "undefined") {
    // @ts-ignore
    (window).sb = supabase;
}
function setNickname(v: string) {
    localStorage.setItem("autoppt:nickname", v);
}

export default function StudentPage() {
    const roomCode = useRoomId("CLASS-XXXXXX");
    const studentId = useMemo(() => getOrSetStudentId(), []);

    const [slides, setSlides] = useState<SlideMeta[]>([]);
    const [state, setState] = useState<{ slide?: number; step?: number }>({});
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);

    const [answer, setAnswer] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [showToast, setShowToast] = useState(false);

    const [nickname, setNicknameState] = useState(getNickname());
    const [editNick, setEditNick] = useState(false);
    const [nickInput, setNickInput] = useState(nickname);

    const NW: React.CSSProperties = { whiteSpace: "nowrap" };

    const saveNick = () => {
        const v = nickInput.trim();
        if (!v) { alert("닉네임을 입력하세요."); return; }
        setNickname(v);        // localStorage
        setNicknameState(v);   // 화면 즉시 갱신
        setEditNick(false);
    };
    const [deckFileUrl, setDeckFileUrl] = useState<string | null>(null);


    function getPublicUrl(key: string) {
        return supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
    }
    
      const [roomId, setRoomId] = useState<string|null>(null);
      // rooms 최초 로딩 때 roomId도 확보
          useEffect(() => {
                  (async () => {
                          if (!roomCode) return;
                          const { data } = await supabase
                              .from("rooms").select("id,current_deck_id,state")
                              .eq("code", roomCode).maybeSingle();
                          if (data) {
                                  setRoomId(data.id ?? null);
                                  setCurrentDeckId(data.current_deck_id ?? null);
                                  setState((data.state as any) ?? {});
                              }
                      })();
              }, [roomCode]);
    // PDF URL 로딩(조인 → 짧은 재시도 → decks 직접조회 폴백)
    useEffect(() => {
           let cancelled = false;
           (async () => {
                 // 덱이 없어진 경우에만 지움. (있는데 file_key 미전파면 "그대로 유지")
                     if (!currentDeckId || !roomId) { if (!cancelled) setDeckFileUrl(null); return; }
                 const pick = async () => {
                       const { data: rd } = await supabase
                         .from("room_decks").select("decks(file_key)")
                         .eq("room_id", roomId).eq("deck_id", currentDeckId).maybeSingle();
                       return (rd as any)?.decks?.file_key ?? null;
                     };
                 let fk: string | null = null;
                 // 최대 8회(≈1.5s) 재시도 후 폴백 조회
                     for (let i = 0; i < 8 && !fk; i++) {
                       fk = await pick();
                       if (!fk) await new Promise(r => setTimeout(r, 150));
                     }
                 if (!fk) {
                       const { data: d2 } = await supabase.from("decks")
                         .select("file_key").eq("id", currentDeckId).maybeSingle();
                       fk = (d2 as any)?.file_key ?? null;
                     }
                 if (cancelled) return;
                 if (fk) setDeckFileUrl(getPublicUrl(fk)); // fk 없으면 기존 URL 유지
               })();
           return () => { cancelled = true; };
         }, [currentDeckId, roomId]);
          
          
      // 탭 복귀 시 즉시 동기화(실시간 체감 개선)
          useEffect(() => {
                  const onVis = () => { if (document.visibilityState === "visible") refreshRoomNow(); };
                  document.addEventListener("visibilitychange", onVis);
                  return () => document.removeEventListener("visibilitychange", onVis);
              }, []);
    
    useEffect(() => { DBG.info("StudentPage mount", { room: roomCode, studentId }); }, [roomCode, studentId]);

    useEffect(() => { loadSlides().then(setSlides).catch(() => setSlides([])); }, []);

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
                        setShowToast(false); // 진행이 바뀌면 입력창 닫힘
                    }
                )
                .subscribe();

            return () => { supabase.removeChannel(channel); };
        })();
        return () => { cancelled = true; };
    }, [roomCode]);

    const slide = Number(state?.slide ?? 1);
    const step  = Number(state?.step  ?? 0);
    const currentSlide = slides.find((s) => s.slide === slide);
    const currentMeta = currentSlide?.steps?.[step];
    const isQuiz = currentMeta?.kind === "quiz";

    // 학생 ID 고정
    function getOrSetStudentId() {
        const k = "autoppt:student_id";
        let v = localStorage.getItem(k);
        if (!v) { v = "stu-" + Math.random().toString(36).slice(2, 9); localStorage.setItem(k, v); }
        return v;
    }
    function getNickname() {
        const k = "autoppt:nickname";
        return localStorage.getItem(k) ?? "";
    }

    // 새 교시 확인(60s 폴링 + 버튼)
    const [checking, setChecking] = useState(false);
    async function refreshRoom() {
        if (!roomCode) return;
        const { data, error } = await supabase
            .from("rooms")
            .select("current_deck_id, state")
            .eq("code", roomCode)
            .maybeSingle();
        if (!error && data) {
            setCurrentDeckId(data.current_deck_id ?? null);
            setState((data.state as any) ?? {});
            setSubmitted(false);
            setAnswer("");
            setShowToast(false);
        }
    }
    async function refreshRoomNow() { setChecking(true); try { await refreshRoom(); } finally { setChecking(false); } }
    useEffect(() => { const t = setInterval(refreshRoomNow, 60_000); return () => clearInterval(t); }, []);

    // quiz 스텝으로 진입하면 토스트 자동 표출(아직 미제출일 때)
    useEffect(() => {
        if (isQuiz && !submitted) {
            setShowToast(true);
        }
    }, [isQuiz, slide, step, submitted]);

    const handleSubmit = async () => {
        if (!isQuiz) return;
        const userAns = answer.trim();
        const payload = { p_room_code: roomCode, p_slide: slide, p_step: step, p_student_id: studentId, p_answer: userAns };
        DBG.info("answer.submit click", payload);
        const { error } = await rpc("submit_answer_v2", payload);
        if (error) return;
        setSubmitted(true);
        setShowToast(false);
    };

    useEffect(() => {
        if (!currentDeckId) return;
        const ch = supabase.channel(`decks:${currentDeckId}`)
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'decks', filter: `id=eq.${currentDeckId}`
            }, (ev: any) => {
                const fk = ev.new?.file_key;
                if (fk) setDeckFileUrl(supabase.storage.from("presentations").getPublicUrl(fk).data.publicUrl);
            })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [currentDeckId]);


    // Enter 제출 지원
    const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
        if (e.key === "Enter" && !submitted) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="app-shell" style={{ maxWidth: 560 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge" style={NW}>room: {roomCode}</span>
                <span className="badge" style={NW}>내 ID: {studentId}</span>
                <span className="badge" style={NW}>교시: {currentDeckId ? "선택됨" : "미선택"}</span>
                {nickname ? (
                    <span className="badge" style={NW}>닉네임: {nickname}</span>
                ) : (
                    <span className="badge" style={NW}>닉네임: 설정 안 됨</span>
                )}
                <button
                    className="btn"
                    style={{ marginLeft: 8, whiteSpace: "nowrap" }}
                    onClick={() => {
                        setShowToast(false);         // 퀴즈 토스트 닫고
                        setNickInput(nickname);      // 현재 값 프리로드
                        setEditNick(true);           // 닉네임 토스트만 열기
                    }}
                >
                    닉네임 설정
                </button>
                <button
                    className="btn"
                    style={{ marginLeft: 8, whiteSpace: "nowrap" }}
                    onClick={refreshRoomNow}
                    disabled={checking}
                >
                    새 교시 확인
                </button>
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
                            <img src={currentMeta.img} alt="slide" style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 4 }} />
                        ) : null}
                    </div>

                    {/* 기존 하단 입력 패널 제거 → 토스트로 대체 */}
                    {isQuiz ? (
                        <div style={{ display: "flex", justifyContent: "center" }}>
                            <button className="btn" onClick={() => setShowToast(true)} disabled={submitted}>
                                {submitted ? "제출됨" : "정답 입력"}
                            </button>
                        </div>
                    ) : (
                        <div className="lock-banner">교사가 아직 이 스텝을 열지 않았습니다. 잠시 기다려 주세요.</div>
                    )}

                    <div className="panel" style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>현재 자료</div>
                        <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
                            슬라이드 {slide} / 스텝 {step} {isQuiz ? <span style={{ color: "#f97316" }}>(문제)</span> : <span>(설명)</span>}
                        </div>
                        {deckFileUrl ? (
                            <PdfViewer key={`${deckFileUrl}|${slide}`} fileUrl={deckFileUrl} page={slide} />
                        ) : currentMeta?.img ? (
                            <img src={currentMeta.img} alt="slide" style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 4 }} />
                        ) : null}
                    </div>

                    {/* 토스트 입력창 */}
                    {showToast && !submitted && isQuiz && (
                        <div
                            style={{
                                position: "fixed",
                                left: "50%", bottom: 24, transform: "translateX(-50%)",
                                background: "rgba(17,24,39,0.98)",
                                border: "1px solid rgba(148,163,184,0.25)",
                                borderRadius: 12,
                                padding: "12px 12px",
                                boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
                                width: "min(92vw, 420px)",
                                zIndex: 50,
                            }}
                            role="dialog"
                            aria-label="정답 입력"
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, flex: "0 0 auto" }}>정답</div>
                                <input
                                    className="input"
                                    value={answer}
                                    onChange={(e) => setAnswer(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    placeholder="정답 입력 후 Enter"
                                    autoFocus
                                    style={{ flex: 1 }}
                                />
                                <button className="btn" onClick={handleSubmit}>제출</button>
                                <button
                                    className="btn"
                                    onClick={() => setShowToast(false)}
                                    aria-label="닫기"
                                    title="닫기"
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    )}
                    {/* 닉네임 편집 토스트: 정답 토스트 바깥에 독립적으로 둠 */}
                    {editNick && (
                        <div style={{
                            position:'fixed', left:'50%', bottom:72, transform:'translateX(-50%)',
                            background:'rgba(17,24,39,0.98)', border:'1px solid rgba(148,163,184,0.25)',
                            borderRadius:12, padding:'10px', width:'min(92vw, 360px)', zIndex:55
                        }} role="dialog" aria-label="닉네임 설정">
                            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <div style={{ fontWeight:700 }}>닉네임</div>
                                <input className="input" value={nickInput}
                                       onChange={(e)=>setNickInput(e.target.value)}
                                       style={{ flex:1 }} placeholder="표시할 닉네임"/>
                                <button className="btn" onClick={saveNick}>저장</button>
                                <button className="btn" onClick={()=>setEditNick(false)}>×</button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
