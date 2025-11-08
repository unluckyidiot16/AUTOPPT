// src/pages/TeacherPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import PresenceSidebar from "../components/PresenceSidebar";
import { useArrowNav } from "../hooks/useArrowNav";
import { getBasePath } from "../utils/getBasePath";
import SlideStage, { type Overlay } from "../components/SlideStage";
import { slidesPrefixOfPresentationsFile, signedSlidesUrl } from "../utils/supaFiles";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;     // 0-base
    image_key: string | null;      // slides 버킷 내부 경로(옵션)
    overlays: RpcOverlay[];
};
type RpcSlot = { slot: number; lesson_id: string; current_index: number; slides: RpcSlide[] };
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

function useQS() { const { search } = useLocation(); return useMemo(() => new URLSearchParams(search), [search]); }

export default function TeacherPage() {
    const nav = useNavigate();
    const qs = useQS();

    // ---- Room ----
    const defaultCode = useMemo(() => "CLASS-" + Math.random().toString(36).slice(2, 8).toUpperCase(), []);
    const roomCode = useRoomId(defaultCode);
    const [roomId, setRoomId] = useState<string | null>(null);

    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";
    const presence = usePresence(roomCode, "teacher");

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

    // room_id 확보
    const ensureRoomId = useCallback(async () => {
        if (roomId) return roomId;
        const { data } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
        const rid = data?.id ?? null;
        setRoomId(rid);
        return rid;
    }, [roomId, roomCode]);

    // ---- Manifest ----
    const [manifest, setManifest] = useState<RpcManifest | null>(null);
    const loadManifest = useCallback(async () => {
        if (!roomCode) { setManifest(null); return; }
        const data = await rpc<RpcManifest>("get_student_manifest_by_code", { p_room_code: roomCode });
        setManifest(data ?? null);
    }, [roomCode]);

    useEffect(() => { loadManifest(); }, [loadManifest]);
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "refresh" && lastMessage.scope === "manifest") { loadManifest(); return; }
    }, [lastMessage, loadManifest]);

    // ---- Slot / Page ----
    const [activeSlot, setActiveSlot] = useState<number>(1);
    useEffect(() => {
        if (!manifest) return;
        // 교시 없으면 1로, 있으면 첫 교시
        const first = manifest.slots?.[0]?.slot ?? 1;
        setActiveSlot(first);
    }, [manifest]);

    const [page, setPage] = useState<number>(1);
    useEffect(() => {
        if (!manifest) return;
        const slot = manifest.slots.find(s => s.slot === activeSlot);
        if (!slot) return;
        setPage(Number(slot.current_index ?? 0) + 1);
    }, [manifest, activeSlot]);

    const totalPages = useMemo(() => {
        const slot = manifest?.slots?.find((s) => s.slot === activeSlot);
        return slot?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    // ▼▼▼ 배경 URL 해석 (signed URL + 3단 폴백) ▼▼▼
    const deckPrefixCache = useRef(new Map<string, string>()); // deckId -> slidesPrefix(decks/<slug>)
    const [activeBgUrl, setActiveBgUrl] = useState<string | null>(null);
    const [activeOverlays, setActiveOverlays] = useState<Overlay[]>([]);

    const refreshActiveSlide = useCallback(async () => {
        const slot = manifest?.slots?.find((s) => s.slot === activeSlot);
        if (!slot) { setActiveBgUrl(null); setActiveOverlays([]); return; }
        const idx = Math.max(0, page - 1);
        const slide = slot.slides[idx] as RpcSlide | undefined;
        if (!slide) { setActiveBgUrl(null); setActiveOverlays([]); return; }

        const overlays: Overlay[] = (slide.overlays || []).map((o) => ({ id: String(o.id), z: o.z, type: o.type, payload: o.payload }));
        setActiveOverlays(overlays);

        const pageIdx0 = Number(slide.page_index ?? idx); // 0-base
        let key: string | null = slide.image_key ?? null;

        // 1) rooms/<roomId>/decks/<deckId>/<page>.webp
        if (!key && roomId && slide.material_id) {
            key = `rooms/${roomId}/decks/${slide.material_id}/${Math.max(0, pageIdx0)}.webp`;
        }

        // 2) decks/<slug>/<page>.webp  (자료함 원본 경로 폴백)
        if (!key && slide.material_id) {
            let prefix = deckPrefixCache.current.get(slide.material_id);
            if (!prefix) {
                const { data } = await supabase.from("decks").select("file_key").eq("id", slide.material_id).maybeSingle();
                const p = slidesPrefixOfPresentationsFile(data?.file_key ?? null); // presentations/decks/<slug>/slides-*.pdf → decks/<slug>
                if (p) { prefix = p; deckPrefixCache.current.set(slide.material_id, p); }
            }
            if (prefix) key = `${prefix}/${Math.max(0, pageIdx0)}.webp`;
        }

        // 최종 URL(signed)
        if (key) {
            const url = await signedSlidesUrl(key, 1800);
            setActiveBgUrl(url);
        } else {
            setActiveBgUrl(null);
        }
    }, [manifest, activeSlot, page, roomId]);

    useEffect(() => { refreshActiveSlide(); }, [refreshActiveSlide]);

    // 신규 학생 hello → 현재 상태 안내
    useEffect(() => { if (!lastMessage) return; if (lastMessage.type === "hello") sendGoto(page, activeSlot); }, [lastMessage, page, activeSlot, sendGoto]);

    // 페이지 이동
    const gotoPageForSlot = useCallback(async (slot: number, nextPage: number) => {
        const p = Math.max(1, nextPage);
        try {
            const rid = await ensureRoomId();
            const { error } = await supabase.from("room_lessons").update({ current_index: p - 1 }).eq("room_id", rid).eq("slot", slot);
            if (error) throw error;
            setPage(p);
            sendGoto(p, slot);
        } catch (e) {
            DBG.err("gotoPageForSlot", e);
            setPage(p);
            sendGoto(p, slot);
        }
    }, [ensureRoomId, sendGoto]);

    const next = useCallback(async () => { if (totalPages && page >= totalPages) return; await gotoPageForSlot(activeSlot, page + 1); }, [page, totalPages, activeSlot, gotoPageForSlot]);
    const prev = useCallback(async () => { if (page <= 1) return; await gotoPageForSlot(activeSlot, page - 1); }, [page, activeSlot, gotoPageForSlot]);
    useArrowNav(prev, next);

    const studentUrl = useMemo(() => {
        const base = getBasePath();
        return `${location.origin}${base}/#/student?room=${roomCode}&slot=${activeSlot}`;
    }, [roomCode, activeSlot]);

    // ===================== UI =====================
    const StageBlock = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{activeSlot}교시 · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}</div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <span className="badge" title="Realtime">{connected ? "RT:ON" : "RT:OFF"}</span>
            </div>
            <div className="slide-stage" style={{ width: "100%", height: "72vh", display: "grid", placeItems: "center" }}>
                <SlideStage bgUrl={activeBgUrl} overlays={activeOverlays} mode="teacher" />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                <button className="btn" onClick={() => gotoPageForSlot(activeSlot, page)}>🔓 현재 페이지 재전송</button>
                <button className="btn" onClick={next} disabled={!!totalPages && page >= totalPages}>다음 ▶</button>
            </div>
        </div>
    );

    // 우측 설정 패널(기존 내용 유지/생략 가능)
    const SetupRight = (
        <div className="panel" style={{ display: "grid", gap: 16 }}>
            {/* ... 교시/자료 배정 UI ... */}
            <div style={{ fontSize: 12, opacity: .7 }}>교시와 자료를 먼저 배정하세요.</div>
        </div>
    );

    return (
        <div className="app-shell" style={{ maxWidth: 1280 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>교사 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">교시: {activeSlot}</span>
                <span className="badge">페이지: {page}{totalPages ? ` / ${totalPages}` : ""}</span>
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
                            <SlideStage bgUrl={activeBgUrl} overlays={activeOverlays} mode="teacher" />
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
        </div>
    );
}
