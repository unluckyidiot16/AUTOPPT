// src/pages/StudentPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import SlideStage, { type Overlay } from "../components/SlideStage";
import { slidesPrefixOfPresentationsFile, signedSlidesUrl, normalizeSlidesKey } from "../utils/supaFiles";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;   // 0-base
    image_key: string | null;    // slides/* 내부 키 (있으면 우선)
    overlays: RpcOverlay[];
};
type RpcSlot = { slot: number; lesson_id: string | null; current_index: number; slides: RpcSlide[] };
type RpcManifest = { room_code: string; slots: RpcSlot[]; error?: string };

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
    return { room: s.get("room"), slot: Number(s.get("slot") ?? 1) };
}

export default function StudentPage() {
    const { slot } = useQuery();
    const roomCode = useRoomId("CLASS-XXXXXX");

    // room_id (slides 경로 계산용)
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

    // 페이지(1-base)
    const [pageRaw, setPageRaw] = useState<number | null>(null);
    const page = Number(pageRaw ?? 1) > 0 ? Number(pageRaw ?? 1) : 1;

    // Presence / RT (roomCode 기준)
    const presence = usePresence(roomCode, "student");
    const { lastMessage } = useRealtime(roomCode, "student");

    // Manifest
    const [manifest, setManifest] = useState<RpcManifest | null>(null);

    /** ★ RPC 실패 시 폴백 manifest 조립 */
    const buildManifestFallback = useCallback(async (roomCodeStr: string): Promise<RpcManifest | null> => {
        try {
            const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCodeStr).maybeSingle();
            const rid = roomRow?.id as string | undefined;
            if (!rid) return null;

            const { data: lessons } = await supabase
                .from("room_lessons")
                .select("slot,current_index")
                .eq("room_id", rid)
                .order("slot", { ascending: true });

            const { data: maps } = await supabase.from("room_decks").select("slot,deck_id").eq("room_id", rid);

            const deckIds = Array.from(new Set((maps ?? []).map((m: any) => m.deck_id).filter(Boolean)));
            const decks: Record<string, { file_key: string | null; file_pages: number | null }> = {};
            if (deckIds.length) {
                const { data: ds } = await supabase.from("decks").select("id,file_key,file_pages").in("id", deckIds);
                for (const d of ds ?? []) decks[d.id as string] = { file_key: d.file_key ?? null, file_pages: d.file_pages ?? null };
            }

            const slots: RpcSlot[] = (lessons ?? []).map((L: any) => {
                const slot = Number(L.slot);
                const map = (maps ?? []).find((m: any) => Number(m.slot) === slot);
                const deckId = map?.deck_id ?? null;
                const d = deckId ? decks[deckId] : null;
                const pages = Math.max(0, Number(d?.file_pages ?? 0));

                const slides: RpcSlide[] = Array.from({ length: pages }, (_, i) => ({
                    index: i,
                    kind: "image",
                    material_id: deckId,
                    page_index: i,
                    image_key: null,
                    overlays: [],
                }));

                return { slot, lesson_id: null, current_index: Number(L.current_index ?? 0), slides };
            });

            return { room_code: roomCodeStr, slots };
        } catch (e) {
            DBG.err("fallback manifest error", e);
            return null;
        }
    }, []);

    /** 기존 RPC → 실패 시 폴백 */
    const loadManifest = useCallback(async () => {
        if (!roomCode) { setManifest(null); return; }
        try {
            const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
            if (error) throw error;
            setManifest(data ?? null);
        } catch {
            const fb = await buildManifestFallback(roomCode);
            setManifest(fb);
        }
    }, [roomCode, buildManifestFallback]);

    useEffect(() => { loadManifest(); }, [loadManifest]);

    useEffect(() => {
        if (!manifest) return;
        const slotBundle = manifest.slots.find(s => s.slot === activeSlot);
        if (!slotBundle) return;
        setPageRaw(Number(slotBundle.current_index ?? 0) + 1);
    }, [manifest, activeSlot]);

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

    const deckPrefixCache = useRef(new Map<string, string>()); // deckId -> slidesPrefix
    const [activeBgUrl, setActiveBgUrl] = useState<string | null>(null);
    const [activeOverlays, setActiveOverlays] = useState<Overlay[]>([]);

    // 현재 페이지의 배경 이미지 / 오버레이 계산
    useEffect(() => {
        let off = false;

        (async () => {
            const s = manifest?.slots?.find(v => v.slot === activeSlot);
            if (!s) { if (!off) { setActiveBgUrl(null); setActiveOverlays([]); } return; }

            const idx = Math.max(0, page - 1);
            const slide = s.slides[idx] as RpcSlide | undefined;
            if (!slide) { if (!off) { setActiveBgUrl(null); setActiveOverlays([]); } return; }

            // overlays
            if (!off) {
                setActiveOverlays((slide.overlays || []).map(o => ({
                    id: String(o.id), z: o.z, type: o.type, payload: o.payload
                })));
            }

            // 이미지 키 계산
            const pageIdx0 = Number(slide.page_index ?? idx); // 0-base
            let key: string | null = slide.image_key ? normalizeSlidesKey(slide.image_key) : null;

            // 1) rooms/<roomId>/decks/<deckId>/<page>.webp
            if (!key && roomId && slide.material_id) {
                key = `rooms/${roomId}/decks/${slide.material_id}/${Math.max(0, pageIdx0)}.webp`;
            }

            // 2) decks/<slug>/<page>.webp (원본 프리픽스 폴백)
            if (!key && slide.material_id) {
                let prefix = deckPrefixCache.current.get(slide.material_id);
                if (!prefix) {
                    const { data } = await supabase
                        .from("decks").select("file_key")
                        .eq("id", slide.material_id).maybeSingle();
                    const p = slidesPrefixOfPresentationsFile(data?.file_key ?? null);
                    if (p) { prefix = p; deckPrefixCache.current.set(slide.material_id, p); }
                }
                if (prefix) key = `${prefix}/${Math.max(0, pageIdx0)}.webp`;
            }

            if (off) return;

            // 최종 URL
            if (!key) { setActiveBgUrl(null); return; }
            if (/^https?:\/\//i.test(key)) { setActiveBgUrl(key); return; } // 절대 URL은 그대로
            const url = await signedSlidesUrl(key, 1800);
            setActiveBgUrl(url || null);
        })();

        return () => { off = true; };
    }, [manifest, activeSlot, page, roomId]);


    const submitAnswer = async (val: any) => {
        try {
            const payload = {
                p_room_code: roomCode,
                p_slide: page,
                p_step: 0,
                p_student_id: studentId,
                p_answer: typeof (val as any)?.value === "string" ? (val as any).value : JSON.stringify(val),
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
                {nickname ? <span className="badge">닉네임: {nickname}</span> : <span className="badge">닉네임: 설정 안 됨</span>}
                <button className="btn" style={{ marginLeft: 8 }}
                        onClick={() => { setEditNick(v => !v); setNickInput(nickname); }}>
                    닉네임
                </button>
            </div>

            <div className="panel" style={{ padding: 12 }}>
                <div className="slide-stage" style={{ width: "100%", height: "72vh", display: "grid", placeItems: "center" }}>
                    <SlideStage bgUrl={activeBgUrl} overlays={activeOverlays} mode="student" onSubmit={submitAnswer} />
                </div>
            </div>

            {editNick && (
                <div className="panel" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <input className="input" value={nickInput} onChange={e => setNickInput(e.target.value)} placeholder="닉네임" />
                    <button className="btn" onClick={saveNick}>저장</button>
                </div>
            )}
        </div>
    );
}
