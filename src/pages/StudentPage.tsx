// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import SlideStage, { type Overlay } from "../components/SlideStage";
import { slidesPrefixOfPresentationsFile, signedSlidesUrl } from "../utils/supaFiles";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;
    image_key: string | null; // slides 버킷 내부 경로
    overlays: RpcOverlay[];
};
type RpcSlot = {
    slot: number;
    lesson_id: string;
    current_index: number; // 0-base
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

function useQuery() {
    const s = new URLSearchParams(location.hash.split("?")[1] ?? location.search);
    return {
        room: s.get("room"),
        slot: Number(s.get("slot") ?? 1),
    };
}

export default function StudentPage() {
    const { slot } = useQuery();
    const roomCode = useRoomId("CLASS-XXXXXX");
    const [roomId, setRoomId] = useState<string | null>(null);
    useEffect(() => {
        (async () => {
            if (!roomCode) { setRoomId(null); return; }
            const { data } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
            setRoomId(data?.id ?? null);
        })();
    }, [roomCode]);
    const studentId = useMemo(() => getOrSetStudentId(), []);
    const [nickname, setNicknameState] = useState(getNickname());
    const [editNick, setEditNick] = useState(false);
    const [nickInput, setNickInput] = useState(nickname);

    const [activeSlot, setActiveSlot] = useState<number>(slot > 0 ? slot : 1);
    const [pageRaw, setPageRaw] = useState<number | null>(null);
    const page = Number(pageRaw ?? 1) > 0 ? Number(pageRaw ?? 1) : 1;

    const [manifest, setManifest] = useState<RpcManifest | null>(null);

    const presence = usePresence(roomCode, "student", { studentId, nickname, heartbeatSec: 10 });

    const loadManifest = useCallback(async () => {
        if (!roomCode) { setManifest(null); return; }
        const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
        if (error) { setManifest(null); return; }
        setManifest(data);
    }, [roomCode]);
    useEffect(() => { loadManifest(); }, [loadManifest]);

    useEffect(() => {
        if (!manifest) return;
        const slotBundle = manifest.slots.find(s => s.slot === activeSlot);
        if (!slotBundle) return;
        setPageRaw(Number(slotBundle.current_index ?? 0) + 1);
    }, [manifest, activeSlot]);

    const { lastMessage } = useRealtime(roomCode, "student");
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            if (typeof lastMessage.slot === "number") setActiveSlot(lastMessage.slot);
            if (typeof lastMessage.page === "number") setPageRaw(Math.max(1, lastMessage.page));
            return;
        }
        if (lastMessage.type === "refresh" && lastMessage.scope === "manifest") {
            loadManifest();
            return;
        }
    }, [lastMessage, loadManifest]);

    const totalPages = useMemo(() => {
        const s = manifest?.slots?.find(v => v.slot === activeSlot);
        return s?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    // ▼▼▼ 핵심: 배경 URL 해석 (signed URL + 3단 폴백) ▼▼▼
    const deckPrefixCache = useRef(new Map<string, string>()); // deckId -> slidesPrefix(decks/<slug>)
    const [activeBgUrl, setActiveBgUrl] = useState<string | null>(null);
    const [activeOverlays, setActiveOverlays] = useState<Overlay[]>([]);

    const refreshActive = useCallback(async () => {
        const s = manifest?.slots?.find(v => v.slot === activeSlot);
        if (!s) { setActiveBgUrl(null); setActiveOverlays([]); return; }
        const idx = Math.max(0, page - 1);
        const slide = s.slides[idx] as RpcSlide | undefined;
        if (!slide) { setActiveBgUrl(null); setActiveOverlays([]); return; }

        setActiveOverlays((slide.overlays || []).map(o => ({ id: String(o.id), z: o.z, type: o.type, payload: o.payload })));

        const pageIdx0 = Number(slide.page_index ?? idx); // 0-base
        let key: string | null = slide.image_key ?? null;

        // 1) rooms/<roomId>/decks/<deckId>/<page>.webp
        if (!key && roomId && slide.material_id) {
            key = `rooms/${roomId}/decks/${slide.material_id}/${Math.max(0, pageIdx0)}.webp`;
        }

        // 2) decks/<slug>/<page>.webp (자료함 원본 폴백)
        if (!key && slide.material_id) {
            let prefix = deckPrefixCache.current.get(slide.material_id);
            if (!prefix) {
                const { data } = await supabase.from("decks").select("file_key").eq("id", slide.material_id).maybeSingle();
                const p = slidesPrefixOfPresentationsFile(data?.file_key ?? null);
                if (p) { prefix = p; deckPrefixCache.current.set(slide.material_id, p); }
            }
            if (prefix) key = `${prefix}/${Math.max(0, pageIdx0)}.webp`;
        }

        if (key) {
            const url = await signedSlidesUrl(key, 1800);
            setActiveBgUrl(url);
        } else {
            setActiveBgUrl(null);
        }
    }, [manifest, activeSlot, page, roomId]);

    useEffect(() => { refreshActive(); }, [refreshActive]);

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

    const saveNick = () => {
        const v = nickInput.trim();
        if (!v) { alert("닉네임을 입력하세요."); return; }
        setNicknameLS(v); setNicknameState(v); setEditNick(false);
        presence.track({ nick: v });
    };

    return (
        <div className="app-shell" style={{ maxWidth: 1080 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">내 ID: {studentId}</span>
                <span className="badge">교시: {activeSlot}</span>
                <span className="badge">페이지: {page}{totalPages ? ` / ${totalPages}` : ""}</span>
                {nickname ? (
                    <span className="badge">닉네임: {nickname}</span>
                ) : (
                    <span className="badge">닉네임: 설정 안 됨</span>
                )}
                <button className="btn" style={{ marginLeft: 8 }}
                        onClick={() => { setEditNick(v => !v); setNickInput(nickname); }}>
                    닉네임
                </button>
            </div>

            {!manifest ? (
                <div className="panel">수업 자료를 불러오는 중입니다…</div>
            ) : (
                <div className="panel" style={{ display: "grid", placeItems: "center" }}>
                    <div style={{ width: "100%", height: "76vh", display: "grid", placeItems: "center" }}>
                        <SlideStage
                            bgUrl={activeBgUrl}
                            overlays={activeOverlays}
                            mode="student"
                            onSubmit={submitAnswer}
                        />
                    </div>
                </div>
            )}

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
