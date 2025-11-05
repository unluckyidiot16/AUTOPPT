// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { getBasePath } from "../utils/getBasePath";
import { useRealtime } from "../hooks/useRealtime";
import { loadSlides, type SlideMeta } from "../slideMeta";
import PdfViewer from "../components/PdfViewer";

const DEBUG = true;
const DBG = {
  info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
  ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
  err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

// --- tiny helpers ---
function uid() { return Math.random().toString(36).slice(2); }
function getOrSetStudentId() {
  let v = localStorage.getItem("autoppt:student-id");
  if (!v) { v = `stu-${uid()}`; localStorage.setItem("autoppt:student-id", v); }
  return v;
}
function getNickname() { return localStorage.getItem("autoppt:nickname") || ""; }
function setNicknameLS(v: string) { localStorage.setItem("autoppt:nickname", v); }

export default function StudentPage() {
  const roomCode = useRoomId("CLASS-XXXXXX");
  const studentId = useMemo(() => getOrSetStudentId(), []);

  const [slides, setSlides] = useState<SlideMeta[]>([]);
  const [state, setState] = useState<{ slide?: number; step?: number }>({});
  const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [deckFileUrl, setDeckFileUrl] = useState<string | null>(null);

  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const [nickname, setNicknameState] = useState(getNickname());
  const [editNick, setEditNick] = useState(false);
  const [nickInput, setNickInput] = useState(nickname);

  const NW: React.CSSProperties = { whiteSpace: "nowrap" };

  // Slides metadata
  useEffect(() => { loadSlides().then(setSlides).catch(() => setSlides([])); }, []);

  // Fetch initial room row
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase.from("rooms").select("id, current_deck_id, state").eq("code", roomCode).maybeSingle();
      if (cancel) return;
      if (data) {
        setRoomId(data.id);
        setCurrentDeckId(data.current_deck_id ?? null);
        if (data.state) setState({ slide: data.state.slide ?? 1, step: data.state.step ?? 0 });
      }
    })();
    return () => { cancel = true; };
  }, [roomCode]);

  // Realtime sync channel (student)
  const { connected, lastMessage, send } = useRealtime(roomCode, "student");
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "goto") {
      setState({ slide: lastMessage.slide, step: lastMessage.step });
      setSubmitted(false);
    }
  }, [lastMessage]);

  // Watch current_deck_id changes
  useEffect(() => {
    if (!roomId) return;
    const ch = supabase
      .channel(`rooms:${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (ev: any) => {
        setCurrentDeckId(ev.new?.current_deck_id ?? null);
        const st = ev.new?.state ?? null;
        if (st) setState({ slide: st.slide ?? 1, step: st.step ?? 0 });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

    // Resolve file_key safely via RPC (student-safe)
    useEffect(() => {
            let cancelled = false;
            (async () => {
                  if (!currentDeckId) { setDeckFileUrl(null); return; }
                  try {
                        const key: string | null = await supabase.rpc("get_current_deck_file_key_public", { p_code: roomCode }).then(r => (r.error ? null : (r.data as any)));
                        if (cancelled) return;
                        if (key) {
                              const url = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                              setDeckFileUrl(url);
                            } else {
                              setDeckFileUrl(null);
                            }
                      } catch {
                        if (!cancelled) setDeckFileUrl(null);
                      }
                })();
            return () => { cancelled = true; };
          }, [roomCode, currentDeckId]);

  const slide = Number(state?.slide ?? 1);
  const step  = Number(state?.step ?? 0);
  const isQuiz = useMemo(() => {
    const s = slides.find((x) => x.slide === slide);
    const meta = s?.steps?.[step];
    return meta?.kind === "quiz";
  }, [slides, slide, step]);

  useEffect(() => { if (isQuiz && !submitted) setShowToast(true); }, [isQuiz, slide, step, submitted]);

  const saveNick = () => {
    const v = nickInput.trim();
    if (!v) { alert("닉네임을 입력하세요."); return; }
    setNicknameLS(v); setNicknameState(v); setEditNick(false);
  };

  const handleSubmit = async () => {
    if (!isQuiz) return;
    const userAns = answer.trim();
    const payload = { p_room_code: roomCode, p_slide: slide, p_step: step, p_student_id: studentId, p_answer: userAns };
    DBG.info("answer.submit click", payload);
    const { error } = await supabase.rpc("submit_answer_v2", payload);
    if (!error) { setSubmitted(true); setShowToast(false); }
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && !submitted) { e.preventDefault(); handleSubmit(); }
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
        <button className="btn" style={{ marginLeft: 8, whiteSpace: "nowrap" }}
                onClick={() => { setEditNick(v => !v); setNickInput(nickname); }}>
          닉네임
        </button>
      </div>

      {!currentDeckId ? (
        <div className="panel">수업이 아직 시작되지 않았습니다. 조금만 기다려 주세요.</div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>현재 자료</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
              슬라이드 {slide} / 스텝 {step} {isQuiz ? <span style={{ color: "#f97316" }}>(문제)</span> : <span>(설명)</span>}
            </div>
            {deckFileUrl ? (
              // key helps ensure page re-render across some browsers
                <PdfViewer key={`${deckFileUrl}|${currentDeckId}`} fileUrl={deckFileUrl} page={slide} />
            ) : (
              (() => {
                const s = slides.find(x => x.slide === slide);
                const m = s?.steps?.[step];
                return m?.img ? (
                  <img src={`${getBasePath()}${m.img}`} alt="slide"
                       style={{ maxWidth: "100%", borderRadius: 14, marginBottom: 4 }} />
                ) : (
                  <div style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>
                    자료가 준비되지 않았습니다.
                  </div>
                );
              })()
            )}
          </div>

          {isQuiz ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button className="btn" onClick={() => setShowToast(true)} disabled={submitted}>
                {submitted ? "제출됨" : "정답 입력"}
              </button>
            </div>
          ) : (
            <div className="panel" style={{ textAlign: "center", opacity: 0.7 }}>교사의 진행을 따라주세요.</div>
          )}
        </>
      )}

      {/* Quiz toast */}
      {showToast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 72, transform: "translateX(-50%)",
          background: "rgba(17,24,39,0.98)", border: "1px solid rgba(148,163,184,0.25)",
          borderRadius: 12, padding: "10px", width: "min(92vw, 360px)", zIndex: 55
        }} role="dialog" aria-label="정답 입력">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={answer} onChange={(e)=>setAnswer(e.target.value)} onKeyDown={onKeyDown}
                   placeholder="정답을 입력하세요" style={{ flex: 1 }} />
            <button className="btn" onClick={handleSubmit} disabled={submitted}>제출</button>
            <button className="btn" onClick={() => setShowToast(false)} aria-label="닫기" title="닫기">×</button>
          </div>
        </div>
      )}

      {/* Nickname toast */}
      {editNick && (
        <div style={{
          position:"fixed", left:"50%", bottom:72, transform:"translateX(-50%)",
          background:"rgba(17,24,39,0.98)", border:"1px solid rgba(148,163,184,0.25)",
          borderRadius:12, padding:"10px", width:"min(92vw, 360px)", zIndex:55
        }} role="dialog" aria-label="닉네임 설정">
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ fontWeight:700 }}>닉네임</div>
            <input className="input" value={nickInput} onChange={(e)=>setNickInput(e.target.value)} style={{ flex:1 }} />
            <button className="btn" onClick={saveNick}>저장</button>
            <button className="btn" onClick={() => setEditNick(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
