// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import SlideStage, { type Overlay } from "../components/SlideStage";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string; // "material" | "quiz" | ...
    material_id: string | null;
    page_index: number | null;
    image_key: string | null; // slides 버킷 내부 경로
    overlays: RpcOverlay[];
};

type RpcSlot = {
    slot: number;
    lesson_id: string;
    current_index: number;
    slides: RpcSlide[];
};

type RpcManifest = {
    room_code: string;
    slots: RpcSlot[];
    error?: string;
};

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

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
    const [nickname, setNicknameState] = useState(getNickname());
    const [editNick, setEditNick] = useState(false);
    const [nickInput, setNickInput] = useState(nickname);

    // 페이지 인덱스(1-base). 신호는 기존 realtime과 rooms.state.page를 그대로 이용
    const [pageRaw, setPageRaw] = useState<number | null>(null);
    const page = Number(pageRaw ?? 1) > 0 ? Number(pageRaw ?? 1) : 1;

    // 매니페스트 (RPC)
    const [manifest, setManifest] = useState<RpcManifest | null>(null);
    const [activeSlot, setActiveSlot] = useState<number>(1); // 필요 시 slot=1 우선

    // Presence
    const presence = usePresence(roomCode, "student", {
        studentId,
        nickname,
        heartbeatSec: 10,
    });

    // 초기 rooms row → page 동기화
    useEffect(() => {
        let cancel = false;
        (async () => {
            const { data } = await supabase
                .from("rooms")
                .select("id, state")
                .eq("code", roomCode)
                .maybeSingle();
            if (cancel) return;
            const pg = Number(data?.state?.page ?? 1);
            setPageRaw(pg > 0 ? pg : 1);
        })();
        return () => { cancel = true; };
    }, [roomCode]);

    // 매니페스트 로드
    useEffect(() => {
        let cancel = false;
        (async () => {
            if (!roomCode) return setManifest(null);
            const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
            if (!cancel) {
                if (error) { DBG.err("manifest rpc", error.message || error); setManifest(null); }
                else setManifest(data as RpcManifest);
            }
        })();
        return () => { cancel = true; };
    }, [roomCode]);

    // realtime goto
    const { lastMessage } = useRealtime(roomCode, "student");
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto" && typeof lastMessage.page === "number") {
            setPageRaw(Math.max(1, lastMessage.page));
        }
    }, [lastMessage]);

    // 닉 저장
    const saveNick = () => {
        const v = nickInput.trim();
        if (!v) { alert("닉네임을 입력하세요."); return; }
        setNicknameLS(v); setNicknameState(v); setEditNick(false);
        presence.track({ nick: v });
    };

    // 활성 슬라이드 계산
    const totalPages = useMemo(() => {
        const slot = manifest?.slots?.find(s => s.slot === activeSlot) ?? manifest?.slots?.[0];
        return slot?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    const active = useMemo(() => {
        if (!manifest) return null;
        const slot = manifest.slots.find(s => s.slot === activeSlot) ?? manifest.slots[0];
        if (!slot) return null;
        const idx = Math.max(0, page - 1);
        const s = slot.slides[idx] as RpcSlide | undefined;
        if (!s) return null;
        const bgUrl = s.image_key ? supabase.storage.from("slides").getPublicUrl(s.image_key).data.publicUrl : null;
        const overlays: Overlay[] = (s.overlays || []).map(o => ({ id: String(o.id), z: o.z, type: o.type, payload: o.payload }));
        return { bgUrl, overlays };
    }, [manifest, activeSlot, page]);

    const submitAnswer = async (val: any) => {
        try {
            const payload = {
                p_room_code: roomCode,
                p_slide: page,
                p_step: 0,
                p_student_id: studentId,
                p_answer: typeof val?.value === "string" ? val.value : JSON.stringify(val),
            };
            await supabase.rpc("submit_answer_v2", payload);
        } catch (e: any) {
            alert(e?.message ?? String(e));
        }
    };

    return (
        <div className="app-shell" style={{ maxWidth: 1080 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">내 ID: {studentId}</span>
                <span className="badge">페이지: {page}{totalPages ? ` / ${totalPages}` : ""}</span>
                {nickname ? (
                    <span className="badge">닉네임: {nickname}</span>
                ) : (
                    <span className="badge">닉네임: 설정 안 됨</span>
                )}
                <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setEditNick(v => !v); setNickInput(nickname); }}>
                    닉네임
                </button>
            </div>

            {!manifest ? (
                <div className="panel">수업 자료를 불러오는 중입니다…</div>
            ) : (
                <div className="panel" style={{ display: "grid", placeItems: "center" }}>
                    <div style={{ width: "100%", height: "76vh", display: "grid", placeItems: "center" }}>
                        <SlideStage
                            bgUrl={active?.bgUrl ?? null}
                            overlays={active?.overlays ?? []}
                            mode="student"
                            onSubmit={submitAnswer}
                        />
                    </div>
                </div>
            )}

            {/* 닉네임 토스트 */}
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
