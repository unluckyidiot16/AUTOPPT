// src/pages/TeacherPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import PresenceSidebar from "../components/PresenceSidebar";
import { useArrowNav } from "../hooks/useArrowNav";
import { getBasePath } from "../utils/getBasePath";
import { RoomQR } from "../components/RoomQR";
import SlideStage, { type Overlay } from "../components/SlideStage";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;
    image_key: string | null;
    overlays: RpcOverlay[];
};
type RpcSlot = { slot: number; lesson_id: string; current_index: number; slides: RpcSlide[]; };
type RpcManifest = { room_code: string; slots: RpcSlot[]; error?: string };

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

async function rpc<T = any>(fn: string, args?: Record<string, any>) {
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) { DBG.err("rpc error:", fn, error.message || error); throw error; }
    return data as T;
}

function useQS() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

function useToast(ms = 2000) {
    const [open, setOpen] = useState(false);
    const [msg, setMsg] = useState("");
    const show = (m: string) => { setMsg(m); setOpen(true); setTimeout(() => setOpen(false), ms); };
    const node = open ? (
        <div style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "rgba(17,24,39,0.98)", color: "#fff", border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 24px rgba(0,0,0,0.35)", zIndex: 60
        }}>{msg}</div>
    ) : null;
    return { show, node };
}

function useFullscreenTarget(selector: string) {
    const [isFS, setIsFS] = useState(false);
    useEffect(() => {
        const h = () => setIsFS(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", h);
        return () => document.removeEventListener("fullscreenchange", h);
    }, []);
    const toggle = useCallback(() => {
        const el = (document.querySelector(selector) as HTMLElement) || document.documentElement;
        const doc: any = document;
        if (!doc.fullscreenElement) el.requestFullscreen?.();
        else doc.exitFullscreen?.();
    }, [selector]);
    return { isFS, toggle };
}

export default function TeacherPage() {
    const nav = useNavigate();
    const qs = useQS();
    const toast = useToast();

    // ---- Room ----
    const defaultCode = useMemo(() => "CLASS-" + Math.random().toString(36).slice(2, 8).toUpperCase(), []);
    const roomCode = useRoomId(defaultCode);
    const [roomId, setRoomId] = useState<string | null>(null);

    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";
    const presence = usePresence(roomCode, "teacher");
    const { isFS, toggle: toggleFS } = useFullscreenTarget(".slide-stage");

    const { connected, lastMessage, sendGoto, sendRefresh } = useRealtime(roomCode, "teacher");

    // URL 정리
    useEffect(() => {
        const url = new URLSearchParams(qs.toString());
        if (!url.get("room") && roomCode) {
            url.set("room", roomCode);
            if (!url.get("mode")) url.set("mode", "present");
            nav(`/teacher?${url.toString()}`, { replace: true });
        }
    }, [roomCode, qs, nav]);

    // roomId 보장
    const ensureRoomId = useCallback(async (): Promise<string> => {
        if (roomId) return roomId;
        const { data, error } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        if (error || !data?.id) throw new Error("ROOM_NOT_FOUND");
        setRoomId(data.id);
        return data.id;
    }, [roomId, roomCode]);

    // 초기 roomId 로드
    useEffect(() => {
        (async () => { try { await ensureRoomId(); } catch (e) { DBG.err(e); } })();
    }, [ensureRoomId]);

    // 2) 페이지 마운트 시 가드 + 호스트 잠금(옵션)
    useEffect(() => {
        (async () => {
            try {
                await ensureRoomId();
                const { error } = await supabase.rpc("claim_host", { p_room_code: roomCode });
                if (error && error.message.includes("BUSY")) {
                    alert("다른 교사가 발표 중입니다.");
                }
            } catch (e:any) {
                if (e.message === "ROOM_NOT_FOUND") {
                    alert("방이 없습니다. 로비에서 방을 생성/선택하세요.");
                    location.href = "/AUTOPPT/#/lobby";
                }
            }
        })();
    }, [ensureRoomId, roomCode]);

    // manifest
    const [manifest, setManifest] = useState<RpcManifest | null>(null);
    const refreshManifest = useCallback(async () => {
        if (!roomCode) return setManifest(null);
        try {
            const data = await rpc<RpcManifest>("get_student_manifest_by_code", { p_room_code: roomCode });
            setManifest(data);
        } catch (e) {
            DBG.err("manifest rpc", e);
            setManifest(null);
        }
    }, [roomCode]);
    useEffect(() => { refreshManifest(); }, [refreshManifest]);

    // ===== 교시(슬롯) 목록 관리 =====
    const [slots, setSlots] = useState<number[]>([]);
    const [activeSlot, setActiveSlot] = useState<number>(1);

    const refreshSlotsList = useCallback(async () => {
        try {
            const rid = await ensureRoomId();
            const { data, error } = await supabase
                .from("room_lessons").select("slot").eq("room_id", rid).order("slot", { ascending: true });
            if (error) throw error;
            const arr = (data || []).map((r: any) => Number(r.slot));
            setSlots(arr);
            if (arr.length && !arr.includes(activeSlot)) setActiveSlot(arr[0]);
        } catch (e) {
            DBG.err("refreshSlotsList", e);
        }
    }, [ensureRoomId, activeSlot]);
    useEffect(() => { refreshSlotsList(); }, [refreshSlotsList]);

    // 교시 row 보장
    const ensureSlotRow = useCallback(async (slot: number) => {
        const rid = await ensureRoomId();
        const { error } = await supabase
            .from("room_lessons")
            .upsert({ room_id: rid, slot, current_index: 0 }, { onConflict: "room_id,slot" });
        if (error) throw error;
    }, [ensureRoomId]);

    // 교시 생성
    const createSlot = useCallback(async () => {
        try {
            await ensureRoomId();
            const used = new Set(slots);
            let next = 1; while (used.has(next) && next <= 12) next++;
            if (next > 12) { toast.show("더 이상 교시를 만들 수 없습니다."); return; }
            await ensureSlotRow(next);
            await refreshSlotsList();
            setActiveSlot(next);
            toast.show(`${next}교시 생성`);
            sendRefresh("manifest");
        } catch (e: any) { toast.show(e?.message ?? String(e)); }
    }, [ensureRoomId, ensureSlotRow, refreshSlotsList, slots, toast, sendRefresh]);

    // activeSlot → page
    const [page, setPage] = useState<number>(1);
    const syncPageFromSlot = useCallback(async (slot: number) => {
        try {
            const rid = await ensureRoomId();
            const { data } = await supabase
                .from("room_lessons").select("current_index").eq("room_id", rid).eq("slot", slot).maybeSingle();
            const idx = Number(data?.current_index ?? 0);
            setPage(idx + 1);
        } catch (e) { DBG.err("syncPageFromSlot", e); }
    }, [ensureRoomId]);
    useEffect(() => { syncPageFromSlot(activeSlot); }, [activeSlot, syncPageFromSlot]);

    // total & active (no-fallback)
    const totalPages = useMemo(() => {
        const slot = manifest?.slots?.find(s => s.slot === activeSlot);
        return slot?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    function currentSlide(): RpcSlide | null {
        const slot = manifest?.slots?.find(s => s.slot === activeSlot);
        if (!slot) return null;
        const idx = Math.max(0, page - 1);
        return slot.slides[idx] ?? null;
    }
    const active = useMemo(() => {
        const s = currentSlide(); if (!s) return null;
        const bgUrl = s.image_key ? supabase.storage.from("slides").getPublicUrl(s.image_key).data.publicUrl : null;
        const overlays: Overlay[] = (s.overlays || []).map(o => ({ id: String(o.id), z: o.z, type: o.type, payload: o.payload }));
        return { bgUrl, overlays };
    }, [manifest, page, activeSlot]);

    // Realtime: 신규 학생 hello → 현재 상태 안내
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "hello") sendGoto(page, activeSlot);
    }, [lastMessage, page, activeSlot, sendGoto]);

    // 페이지 이동
    const gotoPageForSlot = useCallback(async (slot: number, nextPage: number) => {
        const p = Math.max(1, nextPage);
        try {
            const rid = await ensureRoomId();
            const { error } = await supabase
                .from("room_lessons")
                .update({ current_index: p - 1 }).eq("room_id", rid).eq("slot", slot);
            if (error) throw error;
            setPage(p);
            sendGoto(p, slot);
        } catch (e) {
            DBG.err("gotoPageForSlot", e);
            setPage(p);
            sendGoto(p, slot);
        }
    }, [ensureRoomId, sendGoto]);

    const next = useCallback(async () => {
        if (totalPages && page >= totalPages) return;
        await gotoPageForSlot(activeSlot, page + 1);
    }, [page, totalPages, activeSlot, gotoPageForSlot]);

    const prev = useCallback(async () => {
        if (page <= 1) return;
        await gotoPageForSlot(activeSlot, page - 1);
    }, [page, activeSlot, gotoPageForSlot]);

    useArrowNav(prev, next);

    // 학생 접속 링크
    const studentUrl = useMemo(() => {
        const base = getBasePath();
        return `${location.origin}${base}/#/student?room=${roomCode}&slot=${activeSlot}`;
    }, [roomCode, activeSlot]);

    // 최근 제출
    const [answers, setAnswers] = useState<any[]>([]);
    useEffect(() => {
        (async () => {
            try {
                const rid = await ensureRoomId();
                const { data } = await supabase
                    .from("answers_v2")
                    .select("student_id, answer, slide, step, created_at")
                    .eq("room_id", rid).order("created_at", { ascending: false }).limit(50);
                setAnswers(data || []);
            } catch (e) { DBG.err("answers list", e); }
        })();
    }, [ensureRoomId, page]);

    // ===================== UI =====================
    const StageBlock = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {activeSlot}교시 · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}
                </div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <button className="btn" onClick={toggleFS}>{isFS ? "전체화면 해제" : "전체화면"}</button>
                <span className="badge" title="Realtime">{connected ? "RT:ON" : "RT:OFF"}</span>
            </div>
            <div className="slide-stage" style={{ width: "100%", height: "72vh", display: "grid", placeItems: "center", background: isFS ? "#000" : "transparent" }}>
                <SlideStage bgUrl={active?.bgUrl ?? null} overlays={active?.overlays ?? []} mode="teacher" />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                <button className="btn" onClick={() => gotoPageForSlot(activeSlot, page)}>🔓 현재 페이지 재전송</button>
                <button className="btn" onClick={next} disabled={!!totalPages && page >= totalPages}>다음 ▶</button>
            </div>
        </div>
    );

    // 우측 패널(업로더 제거 → 자료함 링크만)
    const SetupRight = (
        <div className="panel" style={{ display: "grid", gap: 16 }}>
            {/* 교시 관리 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>교시 관리</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <button className="btn" onClick={createSlot}>＋ 교시 생성</button>
                    <span style={{ fontSize: 12, opacity: .7 }}>먼저 교시를 만들고, 그 교시에 자료를 배정하세요.</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {slots.length === 0 ? (
                        <span style={{ opacity: .7 }}>아직 생성된 교시가 없습니다.</span>
                    ) : (
                        slots.map((s) => (
                            <button
                                key={s}
                                className="btn"
                                aria-pressed={activeSlot === s}
                                onClick={() => setActiveSlot(s)}
                                style={activeSlot === s ? { outline: "2px solid #2563eb" } : undefined}
                            >
                                {s}교시
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* 최근 제출 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>최근 제출(50)</div>
                {answers.length === 0 ? (
                    <div style={{ opacity: 0.6 }}>최근 제출이 없습니다.</div>
                ) : (
                    <div style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto" }}>
                        {answers.map((a, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, fontSize: 13 }}>
                                <span className="badge">{a.student_id}</span>
                                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.answer}</span>
                                <span style={{ opacity: 0.7 }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="app-shell" style={{ maxWidth: 980 }}>
            <div className="topbar" style={{ marginBottom: 12 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>교사 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=present`)} aria-pressed={viewMode === "present"}>발표</button>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)} aria-pressed={viewMode === "setup"}>설정</button>
                    <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
                </div>
            </div>

            {viewMode === "present" ? (
                <div className="panel" style={{ padding: 12 }}>
                    <div style={{ display: "grid", gap: 12 }}>{StageBlock}</div>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
                    <div className="panel">
                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                            {activeSlot}교시 · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}
                        </div>
                        <div className="slide-stage" style={{ width: "100%", height: 500, display: "grid", placeItems: "center" }}>
                            <SlideStage bgUrl={active?.bgUrl ?? null} overlays={active?.overlays ?? []} mode="teacher" />
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                            <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                            <button className="btn" onClick={() => gotoPageForSlot(activeSlot, page)}>🔓 현재 페이지 재전송</button>
                            <button className="btn" onClick={next} disabled={!!totalPages && page >= totalPages}>다음 ▶</button>
                        </div>
                    </div>
                    {SetupRight}
                </div>
            )}

            <PresenceSidebar members={presence.members} unfocused={presence.unfocused} />
            {toast.node}
        </div>
    );
}
